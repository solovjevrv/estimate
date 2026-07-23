# Planning Poker

Приложение для покера планирования: командная оценка задач в реальном времени.

## Стек

- **Фронтенд:** Vue 3 (Composition API), TypeScript, Vite, Pinia
- **Бэкенд:** Node.js, Fastify, Socket.io
- **База данных:** PostgreSQL + Drizzle ORM
- **Тесты:** Vitest (unit), Playwright (E2E)

## Структура монорепозитория

| Пакет             | Назначение                            |
| ----------------- | ------------------------------------- |
| `apps/web`        | Клиентское приложение (Vue 3 + Vite)  |
| `apps/server`     | Сервер (Fastify, WebSocket, REST API) |
| `packages/shared` | Общие типы и контракты событий        |

## Требования

- Node.js ≥ 24
- pnpm ≥ 11

## Продакшен

- Деплой автоматический: push в `main` → GitHub Actions → `scripts/deploy.sh` на VPS.
- Приложение: <https://pokerplan.solovyovdev.ru:3000> (TLS на 3000, порт 80 — редирект и ACME).
- Первый выпуск сертификата Let's Encrypt (разово, на сервере, порт 80 должен быть свободен):

```bash
docker compose -f docker-compose.prod.yml create certbot
docker compose -f docker-compose.prod.yml run --rm -p 80:80 \
  --entrypoint "certbot certonly --standalone -d pokerplan.solovyovdev.ru \
  --email <email> --agree-tos --no-eff-email" certbot
```

- Продление автоматическое: сервис `certbot` проверяет сертификат дважды в сутки, nginx перечитывает его при периодическом reload.

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск web и server в dev-режиме
pnpm test           # unit-тесты (Vitest)
pnpm lint           # линтинг (ESLint)
pnpm typecheck      # проверка типов
pnpm build          # сборка всех пакетов
```
