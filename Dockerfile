# Multistage image for the Atlas API + worker (docs/17 §3, DD-2). One image, two runtimes: the
# default CMD runs the API (which also runs the sync worker in-process); override the command to
# `node dist/worker.js` for a dedicated, independently-scaled worker task ("same build, different
# entry command", docs/02 DD-2). Build context is the repo ROOT (pnpm monorepo).
#
#   docker build -t atlas-api .
#   docker run --env-file .env.production -p 4290:4290 atlas-api            # API + in-process worker
#   docker run --env-file .env.production atlas-api node dist/worker.js     # dedicated worker
#
# NOTE: authored offline (no Docker daemon available this session to build-test) — do a `docker build`
# before the first deploy. The runtime is non-root; the web app (Next.js) ships as its own image.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ── build: install the whole workspace, compile every package + the api, then produce a
#    self-contained prod deployment of just the api (its workspace deps injected into node_modules) ──
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@atlas/*" run build && pnpm --filter @atlas/api run build
RUN pnpm --filter @atlas/api deploy --prod --legacy /deploy

# ── runtime: minimal, non-root, production-only deps ──
FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system atlas && useradd --system --gid atlas --create-home atlas
WORKDIR /app
COPY --from=build --chown=atlas:atlas /deploy ./
USER atlas
EXPOSE 4290
# Liveness is cheap; orchestration should probe GET /health (liveness) + /health/ready (DB probe).
CMD ["node", "dist/main.js"]
