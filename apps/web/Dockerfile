# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# Agri-SHIELD web (Next.js 15 + custom Socket.io server)
# Build from the REPO ROOT:  docker build -f apps/web/Dockerfile -t agri-shield-web .
# Author: Nitya Prakash Pandey
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine

# ── base: node + pnpm (pinned to package.json#packageManager) ──
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
WORKDIR /app

# ── deps: install workspace dependencies from the lockfile only ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/i18n/package.json packages/i18n/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@agri-shield/web..."

# ── builder: compile the Next.js app ──
FROM base AS builder
COPY --from=deps /app /app
COPY . .
ENV NODE_ENV=production \
    AGRI_OFFLINE=true \
    AUTH_SECRET=build-time-placeholder-overridden-at-runtime
RUN pnpm --filter @agri-shield/web build

# ── runner: minimal runtime, non-root ──
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat wget
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# Workspace manifests + hoisted pnpm store (node_modules/.pnpm)
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
# Workspace packages consumed as TS source (transpilePackages / tsx worker)
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
# The web app: build output, custom server, server code (for the tsx worker), public assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web ./apps/web
RUN rm -rf /app/apps/web/.next/cache

USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1

# server.js = Next.js request handler + Socket.io realtime layer
CMD ["node", "server.js"]
