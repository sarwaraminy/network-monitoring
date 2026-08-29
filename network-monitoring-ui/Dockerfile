# syntax=docker/dockerfile:1

# Network Monitoring UI: a static Vite bundle served by nginx, which also proxies
# /api and /auth to the API container so the browser makes same-origin requests
# and CORS never comes into play.

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# --ignore-scripts skips postinstall (scripts/setup-env.mjs), which needs
# scripts/ present — copying that in here would bust this cache on any edit to
# it, unrelated to dependencies. The build has no use for the .env files it
# creates anyway.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY network-monitoring-ui/package.json ./network-monitoring-ui/

RUN npm ci --workspaces --include-workspace-root --ignore-scripts

COPY network-monitoring-ui ./network-monitoring-ui

# Empty by default: nginx proxies same-origin, so no absolute API URL is needed.
# Override with --build-arg when the API lives on another host.
ARG VITE_API_SERVER=""
ARG VITE_POLL_INTERVAL_MS="1000"
ENV VITE_API_SERVER=$VITE_API_SERVER
ENV VITE_POLL_INTERVAL_MS=$VITE_POLL_INTERVAL_MS

RUN npx tsc -b network-monitoring-ui && npx vite build network-monitoring-ui

# ---------- runtime ----------
FROM nginx:1.31-alpine AS runtime

COPY network-monitoring-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/network-monitoring-ui/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
