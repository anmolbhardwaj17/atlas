# Multistage image for the Atlas web app (Next.js 15). Counterpart to the root `Dockerfile`, which
# builds the API + worker — docs/17 §3 specifies three runtimes from two images, and this is the one
# that was missing (found by the deploy-readiness audit: the checklist said "the web app builds and
# deploys as its own image" and no such image existed).
#
# Build context is the repo ROOT (pnpm monorepo), same as the API image:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com \
#     -t atlas-web .
#   docker run -p 4291:4291 atlas-web
#
# NOTE: `NEXT_PUBLIC_*` are INLINED INTO THE CLIENT BUNDLE AT BUILD TIME — they are not runtime env.
# They must be passed as --build-arg here, and they must be the real production values, because they
# are baked into the JS the browser downloads. They are public by definition (the Supabase anon key
# is safe to ship; the SERVICE ROLE key must never appear in this image). Changing an API URL or
# Supabase project therefore requires a REBUILD, not just a redeploy.
#
# NOTE: authored without a Docker daemon available — `docker build` this once before the first deploy.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ── build: install the workspace, then produce the standalone server bundle ──
FROM base AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @atlas/web run build

# ── runtime: minimal, non-root, standalone output only ──
FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4291 HOSTNAME=0.0.0.0
RUN groupadd --system atlas && useradd --system --gid atlas --create-home atlas
WORKDIR /app
# The standalone bundle carries its own minimal node_modules; static/ and public/ are served from
# disk beside it and are NOT included in the traced output, so they're copied explicitly.
COPY --from=build --chown=atlas:atlas /app/apps/web/.next/standalone ./
COPY --from=build --chown=atlas:atlas /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=atlas:atlas /app/apps/web/public ./apps/web/public
USER atlas
EXPOSE 4291
# `outputFileTracingRoot` is the repo root, so standalone preserves the workspace layout and the
# server entrypoint lands at apps/web/server.js rather than ./server.js.
CMD ["node", "apps/web/server.js"]
