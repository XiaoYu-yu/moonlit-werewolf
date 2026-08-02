FROM node:24-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai-gateway/package.json packages/ai-gateway/package.json
RUN pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages/ai-gateway packages/ai-gateway
RUN pnpm --filter @werewolf/ai-gateway build \
 && pnpm --filter @werewolf/worker build \
 && CI=true pnpm --filter @werewolf/worker --prod deploy --legacy /prod/worker

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
CMD ["node", "dist/main.js"]
