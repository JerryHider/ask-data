FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY agent-server/package.json agent-server/package.json
RUN corepack pnpm install --filter @askdata/agent-server... --frozen-lockfile

COPY tsconfig.json ./
COPY agent-server agent-server
COPY extensions extensions

WORKDIR /app/agent-server
CMD ["pnpm", "start"]
