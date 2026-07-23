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

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск web и server в dev-режиме
pnpm test           # unit-тесты (Vitest)
pnpm lint           # линтинг (ESLint)
pnpm typecheck      # проверка типов
pnpm build          # сборка всех пакетов
```
