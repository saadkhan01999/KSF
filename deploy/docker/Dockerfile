# =============================================================================
# KSF Pharmacy Management System — application image
# -----------------------------------------------------------------------------
# Two stages. The first installs everything, type-checks and builds the API
# and the website; the second carries only what runs: the compiled API, the
# built website and production dependencies. No compiler, no source maps of
# the server, no secrets — every credential arrives as an environment
# variable at run time.
# =============================================================================

# ------------------------------------------------------------------ build ---
FROM node:22-alpine AS build
WORKDIR /build

# Manifests first, so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --no-audit --no-fund

COPY frontend ./frontend
COPY backend ./backend
COPY scripts ./scripts

# A type error stops the image being produced at all.
RUN npm run typecheck && npm run build && npm prune --omit=dev

# ---------------------------------------------------------------- runtime ---
FROM node:22-alpine AS runtime

# tini forwards `docker stop` to Node, so connections close cleanly.
RUN apk add --no-cache tini curl

ENV NODE_ENV=production \
    PORT=8790 \
    STATIC_DIR=frontend/dist

WORKDIR /app
RUN addgroup -S ksf && adduser -S ksf -G ksf

COPY --from=build --chown=ksf:ksf /build/node_modules ./node_modules
COPY --from=build --chown=ksf:ksf /build/package.json ./package.json
COPY --from=build --chown=ksf:ksf /build/backend/package.json ./backend/package.json
COPY --from=build --chown=ksf:ksf /build/backend/dist ./backend/dist
COPY --from=build --chown=ksf:ksf /build/frontend/dist ./frontend/dist

# Backups and the development mail outbox.
RUN mkdir -p /app/.data/backups && chown -R ksf:ksf /app/.data
VOLUME ["/app/.data"]

USER ksf
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8790/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/server.js"]
