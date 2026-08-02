FROM node:24-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai-gateway/package.json packages/ai-gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/game-core/package.json packages/game-core/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/ai-gateway packages/ai-gateway
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/game-core packages/game-core
RUN pnpm --filter @werewolf/database db:generate \
 && pnpm --filter @werewolf/contracts build \
 && pnpm --filter @werewolf/game-core build \
 && pnpm --filter @werewolf/ai-gateway build \
 && pnpm --filter @werewolf/database build \
 && pnpm --filter @werewolf/api build \
 && pnpm --config.auto-install-peers=false --filter @werewolf/api --prod deploy --legacy /prod/api \
 && PRISMA_DEPLOY_SCHEMA="$(node -e "const fs=require('node:fs');const path=require('node:path');process.stdout.write(path.join(fs.realpathSync('/prod/api/node_modules/@werewolf/database'),'prisma/schema.prisma'))")" \
 && PRISMA_GENERATE_SKIP_AUTOINSTALL=true pnpm --filter @werewolf/database exec prisma generate --schema "$PRISMA_DEPLOY_SCHEMA" \
 && pnpm --filter @werewolf/database deploy --legacy /prod/migrate

FROM node:24-alpine AS runtime-base
ENV NODE_ENV=production
RUN apk add --no-cache openssl
WORKDIR /app

FROM runtime-base AS migration
COPY --from=build --chown=node:node /prod/migrate ./
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM runtime-base AS runtime
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
