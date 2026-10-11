#!/usr/bin/env bash
# Деплой на сервере. Запускается CD-джобой по SSH (или вручную) из любой директории.
set -euo pipefail

APP_DIR="$HOME/estimate"
COMPOSE="docker compose -f docker-compose.prod.yml"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

echo "== Обновляю код (ветка $BRANCH) =="
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "== Собираю образы (последовательно: сервер с 1 ядром, экономим CPU) =="
# Короткий хэш коммита — для футера фронта (build arg APP_VERSION, см. docker-compose.prod.yml)
export APP_VERSION
APP_VERSION="$(git rev-parse --short HEAD)"
# server-2 берёт тот же образ estimate-server — собирается один раз
$COMPOSE build server-1
$COMPOSE build web

echo "== Применяю миграции БД =="
$COMPOSE up -d --wait postgres
# Скрипт приходит по SSH через stdin, а docker compose run его читает и съедает
# остаток файла: без /dev/null деплой молча обрывался сразу после миграций
$COMPOSE run --rm --no-deps -T server-1 node dist/db/migrate.cjs </dev/null

echo "== Обновляю экземпляры сервера по очереди (без простоя) =="
# Пока один экземпляр перезапускается, nginx (ip_hash) отправляет его клиентов
# на соседний — у того общее состояние в Redis, Socket.io переподключается сам
# --no-deps ниже не поднимает зависимости — всё, что проверяет /health
# экземпляра (Redis, MinIO), должно уже работать
$COMPOSE up -d --wait redis minio
for svc in server-1 server-2; do
  if ! $COMPOSE up -d --no-deps --wait "$svc"; then
    echo "ОШИБКА: $svc не вышел в healthy"
    $COMPOSE ps -a
    $COMPOSE logs --tail 80 "$svc"
    exit 1
  fi
done

echo "== Обновляю остальные сервисы =="
# --remove-orphans: убирает контейнер прежнего единственного сервиса server (до 10.18)
if ! $COMPOSE up -d --wait --remove-orphans; then
  echo "ОШИБКА: сервисы не вышли в healthy"
  $COMPOSE ps -a
  $COMPOSE logs --tail 80
  exit 1
fi

echo "== Проверяю состояние контейнеров =="
$COMPOSE ps -a
bad=0
for svc in postgres redis server-1 server-2 web certbot; do
  cid=$($COMPOSE ps -aq "$svc" | head -1)
  status=$(docker inspect -f '{{.State.Status}}' "$cid")
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$cid")
  echo "$svc: status=$status health=$health restarts=$restarts"
  if [ "$status" != "running" ] || { [ "$health" != "healthy" ] && [ "$health" != "none" ]; }; then
    bad=1
  fi
done
if [ "$bad" = "1" ]; then
  echo "ОШИБКА: контейнер упал, в рестарт-цикле или unhealthy"
  $COMPOSE logs --tail 80
  exit 1
fi

if ! curl -fsS http://localhost/health >/dev/null; then
  echo "ОШИБКА: healthcheck через nginx не прошёл"
  $COMPOSE logs --tail 80 server-1 server-2 web
  exit 1
fi

# Проверка TLS без -k: ловит в том числе просроченный/битый сертификат
if ! curl -fsS --resolve estimate.solovyovdev.ru:443:127.0.0.1 \
  https://estimate.solovyovdev.ru/health >/dev/null; then
  echo "ОШИБКА: HTTPS-эндпоинт не прошёл проверку (сертификат?)"
  $COMPOSE logs --tail 40 web certbot
  exit 1
fi

# Старые образы чистим только после успешных проверок — сохраняем путь отката
docker image prune -f >/dev/null

echo "== Последние логи сервера =="
$COMPOSE logs --tail 20 server-1 server-2

echo "Деплой успешен: /health через nginx отвечает"
