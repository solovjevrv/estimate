# Контекст сборки — корень монорепозитория
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.16.0
# Сначала только манифесты — слой pnpm install переживает правки исходников
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @estimate/server
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @estimate/server build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@11.16.0
# sharp (10.15) не бандлится (tsup.config.ts, external) — нативный аддон, ломается
# при инлайне в один CJS-файл. Рантайм-образу нужен настоящий node_modules с ним,
# поэтому здесь повторный pnpm install, уже только прод-зависимости.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --prod --frozen-lockfile --filter @estimate/server
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
WORKDIR /app/apps/server
# Создаём и передаём владение заранее: Docker переносит содержимое (и права)
# этой директории в volume при первом монтировании (10.15)
RUN mkdir -p avatars && chown node:node avatars
EXPOSE 3000
USER node
CMD ["node", "dist/index.cjs"]
