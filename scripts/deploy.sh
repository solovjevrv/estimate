#!/usr/bin/env bash
# Деплой на сервере. Запускается CD-джобой по SSH (или вручную) из любой директории.
set -euo pipefail

APP_DIR="$HOME/poker-planing"
COMPOSE="docker compose -f docker-compose.prod.yml"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

echo "== Обновляю код (ветка $BRANCH) =="
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "== Собираю образы (последовательно: на сервере 2 ГБ RAM) =="
$COMPOSE build server
$COMPOSE build web

echo "== Применяю миграции БД =="
$COMPOSE up -d --wait postgres
# Скрипт приходит по SSH через stdin, а docker compose run его читает и съедает
# остаток файла: без /dev/null деплой молча обрывался сразу после миграций
$COMPOSE run --rm --no-deps -T server node dist/db/migrate.cjs </dev/null

echo "== Обновляю сервисы =="
if ! $COMPOSE up -d --wait; then
  echo "ОШИБКА: сервисы не вышли в healthy"
  $COMPOSE ps -a
  $COMPOSE logs --tail 80
  exit 1
fi

echo "== Проверяю состояние контейнеров =="
$COMPOSE ps -a
bad=0
for svc in postgres server web certbot; do
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
  $COMPOSE logs --tail 80 server web
  exit 1
fi

# Проверка TLS без -k: ловит в том числе просроченный/битый сертификат
if ! curl -fsS --resolve pokerplan.solovyovdev.ru:3000:127.0.0.1 \
  https://pokerplan.solovyovdev.ru:3000/health >/dev/null; then
  echo "ОШИБКА: HTTPS-эндпоинт не прошёл проверку (сертификат?)"
  $COMPOSE logs --tail 40 web certbot
  exit 1
fi

# Старые образы чистим только после успешных проверок — сохраняем путь отката
docker image prune -f >/dev/null

echo "== Последние логи сервера =="
$COMPOSE logs --tail 20 server

echo "Деплой успешен: /health через nginx отвечает"
