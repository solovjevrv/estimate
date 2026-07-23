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

## Устройство серверного кода

Каждый модуль бэкенда собран из трёх слоёв:

- **репозиторий** (`*.repository.ts`) — запросы к БД через Drizzle, ничего не знает про HTTP;
- **сервис** (`*.service.ts`) — правила предметной области, права и транзакции; ошибки бросает
  классами из `src/errors.ts` (`NotFoundError`, `ForbiddenError`, `ConflictError`, …);
- **контроллер** (`*.controller.ts`) + плагин Fastify (`plugin.ts`) — разбор запроса, схемы
  валидации и сериализации, вызов сервиса.

Все исключения превращает в ответы единственный обработчик `src/http/error-handler.ts`:
клиент получает `{ error, message }`, внутренние подробности остаются в логах.

## Аутентификация

Вход — через OAuth Google и Яндекса, сессия хранится в паре JWT (access + refresh)
в httpOnly-куках. Провайдер включается сам, как только в окружении появляются его
`*_CLIENT_ID` и `*_CLIENT_SECRET`; без ключей соответствующий роут просто не заводится.

Настройка нового окружения:

1. Сгенерировать секрет подписи: `openssl rand -base64 48` → `JWT_SECRET` (минимум 32 символа).
2. Завести OAuth-приложения и прописать redirect URI — ровно `<PUBLIC_ORIGIN>/api/auth/<провайдер>/callback`:
   - Google (console.cloud.google.com → Credentials → OAuth client ID, тип Web application), scope `openid`, `email`, `profile`;
   - Яндекс (oauth.yandex.ru → Веб-сервисы), доступы: email, имя пользователя, аватар.
3. Положить `JWT_SECRET`, `PUBLIC_ORIGIN`, `WEB_ORIGIN` и ключи провайдеров в `.env`
   (локально — корень репозитория, на сервере — рядом с `docker-compose.prod.yml`).
   Без `JWT_SECRET` прод-стек не поднимется.

Эндпоинты: `GET /api/auth/providers`, `GET /api/auth/<провайдер>` (старт входа),
`GET /api/auth/<провайдер>/callback`, `GET /api/me`, `POST /api/auth/refresh`, `POST /api/auth/logout`.

## Команды и роли

Роли в команде: `owner` > `admin` > `member` > `guest`. Владелец у команды всегда ровно один —
чтобы выйти или понизить себя, он сначала передаёт владение (прежний владелец становится
администратором). Составом управляет владелец: только он меняет роли и исключает участников.
Администратор приглашает по ссылке, гость видит команду без адресов участников. Выйти из команды
может каждый сам.
Чужие и несуществующие команды отвечают одинаково — `404`, чтобы идентификаторы нельзя было перебирать.

Эндпоинты: `POST /api/teams`, `GET /api/teams`, `GET|PATCH|DELETE /api/teams/:id`,
`GET /api/teams/:id/members`, `PATCH|DELETE /api/teams/:id/members/:userId`,
`POST /api/teams/:id/invite/rotate`, `GET /api/invites/:code` (без входа),
`POST /api/invites/:code/join`.

## Продакшен

- Деплой автоматический: push в `main` → GitHub Actions → `scripts/deploy.sh` на VPS.
- Приложение: <https://pokerplan.solovyovdev.ru:3000> (TLS на 3000, порт 80 — редирект и ACME).
- Первый выпуск сертификата Let's Encrypt — **строго до первого запуска стека** (без сертификата nginx не стартует). Порт 80 должен быть свободен; если web уже запущен — сначала `docker compose -f docker-compose.prod.yml stop web`:

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
