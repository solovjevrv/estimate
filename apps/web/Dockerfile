# Контекст сборки — корень монорепозитория
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.16.0
# Сначала только манифесты — слой pnpm install переживает правки исходников
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @poker/web
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Короткий git-хэш для футера (см. vite.config.ts) — передаётся сборкой,
# без него (локальная сборка без --build-arg) в футере будет 'dev'
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @poker/web build

FROM nginxinc/nginx-unprivileged:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080 3000
