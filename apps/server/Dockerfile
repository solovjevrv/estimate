# Контекст сборки — корень монорепозитория
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.16.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm install --frozen-lockfile --filter @poker/server
RUN pnpm --filter @poker/server build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
EXPOSE 3000
USER node
CMD ["node", "dist/index.cjs"]
