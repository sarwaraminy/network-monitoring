# syntax=docker/dockerfile:1

# Network Monitoring API.
#
# Note on packet capture: libpcap is installed in the runtime image, but capturing
# from inside a container also needs host networking and NET_RAW/NET_ADMIN. See
# docker-compose.capture.yml, and the caveat in the README — on Docker Desktop
# (Windows/macOS) the container cannot see the host's real interfaces at all.

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# Copy only manifests first, so `npm ci` is cached until a dependency changes.
# --ignore-scripts skips postinstall (scripts/setup-env.mjs), which needs
# scripts/ present — copying that in here would bust this cache on any edit to
# it, unrelated to dependencies. The build has no use for the .env files it
# creates anyway.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY network-monitoring-ui/package.json ./network-monitoring-ui/

# The UI is not needed to build the API, but npm workspaces resolves the whole
# tree, so its manifest has to be present.
RUN npm ci --workspaces --include-workspace-root --ignore-scripts

COPY tsconfig*.json ./
COPY api ./api

RUN npx tsc -p api/tsconfig.json \
  && node api/scripts/copy-migrations.mjs

# Drop development dependencies from the tree we are about to copy across.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# libpcap is the capture library; koffi loads it at runtime over FFI. tini gives
# us correct signal forwarding so SIGTERM reaches Node and shutdown runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libpcap0.8 tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

# npm workspaces hoists every dependency to the root, so there is no
# api/node_modules to copy — Node resolves upward from api/dist to /app/node_modules.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/api/dist ./api/dist
COPY --from=build /repo/api/package.json ./api/package.json
COPY --from=build /repo/package.json ./package.json

# Run unprivileged by default. Live capture needs more than this; the capture
# override adds the required capabilities explicitly.
USER node

EXPOSE 8080

# A failing readiness probe means the database is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "api/dist/index.js"]
