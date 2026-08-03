# EstiMate

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

## Документация API

Интерактивная документация (Scalar) — <http://localhost:3000/api/docs>, спецификация OpenAPI —
`/api/openapi.json`. Собирается из схем роутов, отдельного файла спецификации нет.

**На продакшене документация выключена**: она поднимается только когда `NODE_ENV` не равен
`production`. Переопределяется переменной `DOCS_ENABLED` (`true`/`false`).

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

## Комнаты и игровой стол

Комнату можно завести с командой и без. Создатель становится скрам-мастером; для командных
комнат им же считаются владелец и администратор команды. Вход — по прямой ссылке, поэтому
карточка комнаты открыта и гостю: гость представляется именем и получает подписанный токен
сессии, чтобы не потерять свой голос при переподключении.

События стола (Socket.io): `join_room`, `submit_vote`, `reveal_cards`, `start_new_round`,
`update_links`. Каждое проверяет права на сервере. До вскрытия карт наружу уходит только факт
«проголосовал» — сами оценки остаются на сервере. При вскрытии считается среднее по всем
голосам и показывается разброс. Состояние комнаты рассылается целиком одним событием
`room_state`, чтобы у всех участников была одна картина.

### Одновременные действия

За столом все действуют разом, поэтому изменения стола идут под блокировкой строки комнаты:
голос, вскрытие карт и смена раунда выполняются строго по очереди. Опоздавший голос получает
отказ «карты уже вскрыты» и не попадает в уже посчитанное среднее.

Клиент присылает вместе с действием то, что видел на экране, — так сервер отличает намеренное
действие от повторного или запоздавшего:

- `start_new_round` принимает `fromRoundId` — раунд, который клиент видел текущим. Если стол уже
  ушёл вперёд, сервер вернёт в подтверждении актуальный раунд вместо создания нового: двойной клик
  и два скрам-мастера не наплодят пустых раундов.
- `submit_vote` и `reveal_cards` принимают `roundId` — задачу, к которой относится действие.
  Оценка, отправленная в момент смены раунда, не попадёт в следующую задачу, а карты новой задачи
  не вскроются раньше времени: придёт `conflict`.
- `update_links` принимает `roundId` и `version` — раунд и версию ссылок из последнего состояния.
  Если ссылки успел поправить кто-то другой, приходит `conflict`, а не молчаливая перезапись
  чужого текста.

Все эти поля необязательны: без них (и с `null`) проверок нет, поведение остаётся прежним —
у ссылок побеждает последний.

У комнаты есть `revision` — номер, растущий с каждым изменением стола (холостые действия его не
двигают). Рассылки одной комнаты сервер выстраивает в очередь, но клиенту всё равно стоит
отбрасывать снимки с номером меньше уже показанного: после переподключения порядок не гарантирован.

## Продакшен

- Деплой автоматический: push в `main` → GitHub Actions → `scripts/deploy.sh` на VPS.
- Приложение: <https://pokerplan.solovyovdev.ru:3000> (TLS на 3000, порт 80 — редирект и ACME).
- Первый выпуск сертификата Let's Encrypt — **строго до первого запуска стека** (без сертификата nginx не стартует). Порт 80 должен быть свободен; если web уже запущен — сначала `docker compose -f docker-compose.prod.yml stop web`:

```bash
docker compose -f docker-compose.prod.yml create certbot
docker compose -f docker-compose.prod.yml run --rm -p 80:80 \
  --entrypoint "sh -c 'certbot certonly --standalone -d pokerplan.solovyovdev.ru \
  --email <email> --agree-tos --no-eff-email && chown -R root:101 /etc/letsencrypt/live /etc/letsencrypt/archive \
  && chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive'" certbot
```

(`chown`/`chmod` в конце — сертификат по умолчанию `600 root:root`, а nginx в образе `nginx-unprivileged` работает под `uid/gid 101`; без этого шага nginx не сможет прочитать приватный ключ и не запустится)

- Продление автоматическое: сервис `certbot` проверяет сертификат дважды в сутки и переприменяет тот же chown/chmod через `--deploy-hook`, nginx перечитывает сертификат при периодическом reload.

### Переезд на estimate.solovyovdev.ru (в процессе)

Новый домен — за Cloudflare-прокси (443/8443 на сервере заняты VPN, поэтому не SNI-роутер, а
отдельный origin-порт). В Cloudflare: Origin Rule перенаправляет `estimate.solovyovdev.ru` на
origin-порт `2053`, SSL/TLS режим — Full (strict). Сертификат — DNS-01 через API Cloudflare
(`certbot/dns-cloudflare`, токен в `cloudflare.ini` рядом с `.env`, тоже пишется CD и не
попадает в git), поэтому порт 80/webroot для этого домена не нужен вообще.

**Первый выпуск — отдельной командой, строго до того, как задеплоен `nginx.conf` с новым
server-блоком** (иначе nginx откажется стартовать: ссылается на ещё не существующий
сертификат — и уронит заодно и текущий `pokerplan`, это один процесс nginx на оба домена):

```bash
docker compose -f docker-compose.prod.yml run --rm \
  certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/cloudflare/cloudflare.ini \
  -d estimate.solovyovdev.ru \
  --email <email> --agree-tos --no-eff-email \
  && docker compose -f docker-compose.prod.yml exec certbot sh -c \
  'chown -R root:101 /etc/letsencrypt/live /etc/letsencrypt/archive && chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive'
```

Продление — тем же циклом `certbot renew`, что и у старого домена (см. выше): certbot сам
помнит способ для каждого сертификата по отдельности, ничего указывать не нужно.

После подтверждённого переезда — старый домен и его блок в `nginx.conf` убираются отдельным PR.

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск web и server в dev-режиме
pnpm test           # unit-тесты (Vitest)
pnpm lint           # линтинг (ESLint)
pnpm typecheck      # проверка типов
pnpm build          # сборка всех пакетов
```
