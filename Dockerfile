# syntax=docker/dockerfile:1.7
# Backend image shared by the `api` and `worker` services (APP_MODE selects the role).
# Build from the repository root: docker build -t code-guardian-backend .

ARG NODE_IMAGE=node:22-alpine
ARG TRIVY_IMAGE=aquasec/trivy:0.76.2

# --- Trivy CLI binary (client mode in the worker; the DB lives in the trivy-server service)
FROM ${TRIVY_IMAGE} AS trivy

# --- Common base: pnpm + OpenSSL (Prisma engines on musl)
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache openssl && corepack enable
ENV CI=true
WORKDIR /repo

# --- Workspace manifests only, so dependency layers are cached across source edits
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/infrastructure/prisma packages/infrastructure/prisma
COPY packages/nest-common/package.json packages/nest-common/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/

# --- Build: full dependency set, compile every workspace package + the root entrypoint
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "code-guardian..."
COPY tsconfig.base.json tsconfig.entry.json ./
COPY src src
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm build

# --- Production dependencies only (runs `prisma generate` via postinstall)
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "code-guardian..."

# --- Runtime
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache git openssl ca-certificates tini \
  && mkdir -p /scans \
  && chown node:node /scans
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo ./
COPY --from=build --chown=node:node /repo/dist ./dist
COPY --from=build --chown=node:node /repo/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /repo/packages/infrastructure/dist ./packages/infrastructure/dist
COPY --from=build --chown=node:node /repo/packages/nest-common/dist ./packages/nest-common/dist
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/worker/dist ./apps/worker/dist
ENV NODE_ENV=production \
    SCAN_WORK_DIR=/scans \
    NODE_OPTIONS=--max-old-space-size=150
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
