/**
 * Узкий набор для тестовых окружений (интеграционные тесты, E2E): только то,
 * что нужно, чтобы создать пользователя и выписать ему валидную сессию в
 * обход настоящего OAuth-флоу. В отличие от `./index`, не тянет `plugin.ts` —
 * тот зависит от аугментаций типов Fastify (`FastifyInstance.db` и т.п.),
 * которые не видны программе TypeScript пакета-потребителя (например,
 * `apps/e2e`), где `app.ts` не входит в граф компиляции.
 */
export { UsersRepository } from './users.repository';
export { ACCESS_COOKIE, TokenService } from './token.service';
