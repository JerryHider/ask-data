FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/package.json
RUN corepack pnpm install --filter @askdata/web... --frozen-lockfile

COPY tsconfig.json ./
COPY web web
ARG AGENT_SERVER_URL=http://agent-server:3000
ENV AGENT_SERVER_URL=$AGENT_SERVER_URL
ENV NEXT_OUTPUT_STANDALONE=1
RUN corepack pnpm --filter @askdata/web exec next build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

WORKDIR /app/web
CMD ["node", "server.js"]
