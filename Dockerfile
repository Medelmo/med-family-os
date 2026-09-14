# The image the household actually runs.
#
# Three stages so the runtime carries the standalone bundle and nothing
# else — no pnpm store, no source, no dev dependencies, no toolchain. What
# is not in the image cannot be vulnerable in it, which is the cheapest
# form of container hardening there is.
#
# See .dockerignore for what is kept out of the build context, and why that
# file's absence was a bug rather than an omission.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js phones home at build time unless told not to. A self-hosted
# household application has no business making that request.
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Next's standalone `server.js` binds to `process.env.HOSTNAME`, and Docker
# sets that to the container id. Without this the server listens only on
# the address that id resolves to — not on 0.0.0.0, and not on loopback —
# so nothing inside the container can reach it, including its own
# healthcheck. Port publishing still worked, which is exactly why this
# would have gone unnoticed: the application looked fine from outside and
# was unreachable from within.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# The base image ships npm and corepack. The standalone bundle runs with
# `node server.js` and never uses either, and they were the source of
# *every* Node-package finding in the image scan — eleven HIGH and
# CRITICAL advisories in npm's own vendored tree (tar, pacote, sigstore,
# brace-expansion and friends), none of them reachable by anything this
# container runs.
#
# Deleting them is not a trick to quiet the scanner: it is the scanner
# correctly reporting code that has no business being in a runtime image.
# What is not installed cannot be exploited and does not need patching.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Debian security updates for whatever the base image was built before.
#
# The base tag is pinned to a Node major, and its underlying Debian
# packages are only as fresh as the last time that tag was rebuilt — which
# is how a patched `libpcre2` sat in Debian's security archive while the
# image still carried the vulnerable one.
#
# This does make the image non-reproducible byte-for-byte, and that is the
# right trade: a build that reproduces exactly is worth less than one that
# is patched. Rebuilding periodically is the point, not a side effect.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Owned by the unprivileged user the image already provides, so the
# process cannot write over its own code. `node` exists in the official
# image with uid 1000; creating another user would only invite it to
# collide with a bind mount's ownership.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Root is the default and there is no reason for it here: this process
# binds a high port, reads its configuration from the environment, and
# writes nothing to disk. A container escape is worth less against a uid
# that owns nothing.
USER node

EXPOSE 3000

# The application already answers /api/health for this purpose (Phase 1).
# Docker asks it directly rather than compose having to, so `docker run`
# and `docker compose up` report the same truth.
#
# A plain node fetch rather than curl: the slim image has no curl, and
# installing one to ask a question the runtime can already answer would
# add a package — and an attack surface — for nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
