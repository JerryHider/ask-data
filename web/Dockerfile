FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/package.json
RUN corepack pnpm install --filter @askdata/web... --frozen-lockfile

COPY tsconfig.json ./
COPY web web
RUN corepack pnpm --filter @askdata/web build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/web/package.json web/package.json
COPY --from=builder /app/web/.next web/.next
COPY --from=builder /app/web/public web/public
COPY --from=builder /app/web/next.config.mjs web/next.config.mjs

WORKDIR /app/web
CMD ["pnpm", "start"]
