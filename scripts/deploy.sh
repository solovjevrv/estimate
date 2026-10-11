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

# --no-deps ниже не поднимает зависимости — всё, что проверяет /health
# экземпляра (Redis, MinIO), должно уже работать
$COMPOSE up -d --wait redis minio

start_instance() {
  if ! $COMPOSE up -d --no-deps --wait "$1"; then
    echo "ОШИБКА: $1 не вышел в healthy"
    $COMPOSE ps -a
    $COMPOSE logs --tail 80 "$1"
    exit 1
  fi
}

# Единственный сервис server до 10.18 — на первом деплое с двумя экземплярами.
# Ищем по меткам Compose: в файле этого сервиса уже нет
project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' \
  "$($COMPOSE ps -q postgres)")
legacy=$(docker ps -aq --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=server")

if [ -n "$legacy" ]; then
  echo "== Переход с одного сервера на два экземпляра =="
  # По одному шагу: старый nginx смотрит на старый server, пока не поднят
  # новый nginx; и пулы БД старого (50) и двух новых (по 40) вместе не влезли
  # бы в 100 подключений Postgres — поэтому server-2 только после ухода старого
  start_instance server-1
  if ! $COMPOSE up -d --no-deps --wait web; then
    echo "ОШИБКА: web не вышел в healthy"
    $COMPOSE logs --tail 80 web
    exit 1
  fi
  docker stop $legacy >/dev/null
  docker rm $legacy >/dev/null
  start_instance server-2
else
  echo "== Обновляю экземпляры сервера по очереди (без простоя) =="
  # Пока один экземпляр перезапускается, nginx (ip_hash) отправляет его клиентов
  # на соседний — у того общее состояние в Redis, Socket.io переподключается сам
  start_instance server-1
  start_instance server-2
fi

echo "== Обновляю остальные сервисы =="
# --remove-orphans — на случай, если прежний server (до 10.18) не был убран выше
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
