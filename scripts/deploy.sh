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

echo "== Собираю образы =="
$COMPOSE build

echo "== Применяю миграции БД =="
$COMPOSE up -d --wait postgres
$COMPOSE run --rm --no-deps server node dist/db/migrate.cjs

echo "== Обновляю сервисы =="
$COMPOSE up -d
docker image prune -f >/dev/null

echo "== Жду готовности =="
server_cid=$($COMPOSE ps -q server)
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$server_cid" 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 2
done

echo "== Проверяю состояние контейнеров =="
$COMPOSE ps

if $COMPOSE ps | grep -Eiq 'restarting|exited'; then
  echo "ОШИБКА: контейнер в рестарт-цикле или упал"
  $COMPOSE logs --tail 80
  exit 1
fi

if ! curl -fsS http://localhost:3000/health >/dev/null; then
  echo "ОШИБКА: healthcheck через nginx не прошёл"
  $COMPOSE logs --tail 80 server web
  exit 1
fi

echo "== Последние логи сервера =="
$COMPOSE logs --tail 20 server

echo "Деплой успешен: http://localhost:3000/health отвечает"
