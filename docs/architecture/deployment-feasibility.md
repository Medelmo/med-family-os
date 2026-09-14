# Deployment Feasibility

## Current evidence

The provided repository does not contain actual mini-PC hardware inventory or Docker host configuration. Therefore host-specific capacity claims cannot be verified from the repository.

## Recommendation

Run as a dedicated Docker Compose project on the existing Docker host unless inspection reveals a concrete isolation/resource reason to use a VM/LXC.

## Inspection checklist

- `docker version`
- `docker compose version`
- `docker info`
- CPU cores
- RAM
- storage free space and filesystem
- existing reverse proxy
- existing backup system
- existing Docker networks
- host reboot policy
- current PostgreSQL services
- monitoring

## Questions this must answer before production

1. Can the host accommodate app + PostgreSQL?
2. Which reverse proxy is authoritative?
3. Where do encrypted backups live?
4. What hostname is used?
5. Is LAN-only access desired?
6. Is remote access via VPN or reverse proxy?
7. What is the recovery target?
8. What backup retention is practical?

## Decision

Do not create a new VM/LXC by default.

## What the image is, as of the first time anyone built it

Everything below was verified by building and running the image, not
inferred from the Dockerfile. It had never been built before, and three
things were wrong in ways only a build could reveal.

**It did not build at all.** `infrastructure/db/client.ts` threw at import
time when `DATABASE_URL` was unset, and `next build` imports every route
module to collect its configuration — so producing the image required a
live database URL that a build stage has no business holding. The handle
is now connected lazily; the same error still fires on first use, and
`/api/ready` reports it instead of the process dying on import.

**It did not listen where it claimed to.** Next's standalone `server.js`
binds to `process.env.HOSTNAME`, and Docker sets that to the container id
— so the server listened only on the address that id resolves to, not on
`0.0.0.0` and not on loopback. Published ports still worked, which is
precisely why nobody would have noticed: fine from outside, unreachable
from within, and its own healthcheck could never pass. Fixed with an
explicit `HOSTNAME=0.0.0.0`.

**It shipped everything in the working directory.** There was no
`.dockerignore`, so `COPY . .` took `.env` — AUTH_SECRET, the database
URL, CREDENTIAL_KEYS — into the build layer, and took the host's
`node_modules` on top of the Linux ones installed in the deps stage.
@node-rs/argon2 is a native binding, so an image built on a developer
machine would have started cleanly and been unable to hash a password.

What it is now:

| | |
|---|---|
| Runs as | `node` (uid 1000), not root |
| Healthcheck | `/api/health`, in-image, no curl installed |
| Size | ~94 MB |
| Secrets in the image | none; `.env` is excluded from the build context |
| npm / corepack | deleted from the runtime stage |
| Verified | builds, serves, `/api/ready` reaches the database, `docker inspect` reports `healthy` |

## Scanning

`pnpm scan` runs both gates the way CI does, on a machine with Docker and
nothing else installed:

- `pnpm scan:deps` — advisories against the lockfile. Fails on high and
  above; everything is printed.
- `pnpm scan:image` — builds the image and scans it with Trivy. Fails on
  HIGH/CRITICAL **that have a fix available**, and prints the unfixed ones
  separately.

Unfixed findings do not fail the build deliberately. There is nothing to
do about a vulnerability with no patch except change base image, which is
a decision to take deliberately and not one a red build should force. They
stay on screen so that decision can be taken with the evidence in view.

Both gates were checked against a known-vulnerable input as well as a
clean one, because a gate that has only ever passed is a gate nobody has
tested.
