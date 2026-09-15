# Getting started

How to run Med Family OS, sign in for the first time, and host it on a
Docker VM — either one you already have or a new one.

Everything below has been run against this repository. Where something is
a recommendation rather than a verified fact, it says so.

---

## 0. What you need

| | Minimum | Notes |
|---|---|---|
| Node.js | 22 | `engines` pins `>=22`; the image uses `node:22-bookworm-slim` |
| pnpm | 10.34.5 | Pinned via `packageManager`; `corepack enable` installs it |
| Docker | with Compose v2 | `docker compose`, not `docker-compose` |
| PostgreSQL | 18.6 | Provided by the compose file — you do not install it yourself |

The application needs no internet access to run. It will sync with
Paperless or Nextcloud if you connect them, and it will talk to a local
model if you configure one, but neither is required.

---

## 1. Run it locally (development)

```bash
corepack enable && pnpm install
```

Copy the example environment file and fill in real secrets:

```bash
cp .env.example .env
```

Generate each secret separately — do not reuse one value for two
variables:

```bash
openssl rand -base64 32
```

For local development you need four entries:

```dotenv
POSTGRES_PASSWORD=<generated>
DATABASE_URL=postgres://medfamily:<the same value>@localhost:5432/medfamily
AUTH_SECRET=<generated>
HA_READONLY_TOKEN=<generated, at least 32 characters>
```

> The password inside `DATABASE_URL` must match `POSTGRES_PASSWORD`
> exactly. A mismatch shows up as an authentication failure from the
> database, not as a configuration error.

Start PostgreSQL. Locally this picks up `docker-compose.override.yml`,
which publishes the database on `127.0.0.1:5432` so tools on your machine
can reach it:

```bash
docker compose up -d db
```

Apply the migrations, then start the dev server:

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

Open <http://localhost:3000>.

### The override file is development-only

`docker-compose.yml` puts the database on an `internal: true` network and
publishes no port — that is the shipping configuration, and it is
deliberate. `docker-compose.override.yml` relaxes both so that `pnpm dev`,
`drizzle-kit` and `vitest` can reach the container from the host. Compose
loads it automatically when it is present, so **do not copy it to the
server.**

---

## 2. Signing in the first time

There is no seeded account and no default password. The first visit
bootstraps the household.

1. Go to `/` — you are redirected to **`/setup`**.
2. Fill in the household name, your name, your email and a password.
   **Minimum 12 characters** (`bootstrapHousehold.ts`).
3. Submit. This creates the first account, as **OWNER**, and the household.
4. You land on the welcome screen, then on **Today**.

Setup runs exactly once. It is guarded in two places — the page redirects
to `/login` once a household exists, and `bootstrapHousehold` re-checks
inside its transaction — so a second attempt cannot create a second
household, even concurrently.

After that, everyone signs in at **`/login`**, and further household
members are added from **Settings → Family** (never from `/setup` again).

### If you get locked out

Sign-in is rate limited to **5 attempts per 15 minutes per email address**.
The limiter is backed by PostgreSQL with an in-memory fallback. Wait it
out; there is no unlock command. If you have genuinely lost the owner
password, you will need to reset the hash directly in the database — there
is no password-reset email flow, by design (no mail server is assumed).

---

## 3. Hosting it

### 3a. On a Docker host you already have

This is the intended deployment: a separate Compose project alongside your
existing services.

```bash
git clone <your-remote> /opt/med-family-os
cd /opt/med-family-os
cp .env.example .env
```

Fill in `.env` with **fresh secrets — not the ones from your laptop** —
and note that the server uses the container hostname, not localhost:

```dotenv
POSTGRES_PASSWORD=<generated>
DATABASE_URL=postgres://medfamily:<the same value>@db:5432/medfamily
AUTH_SECRET=<generated>
HA_READONLY_TOKEN=<generated>
```

Make sure the override file is not present:

```bash
rm -f docker-compose.override.yml
```

The compose file attaches `app` to an **external** network called
`reverse-proxy`. Create it if your proxy does not already provide one:

```bash
docker network create reverse-proxy
```

Bring it up:

```bash
docker compose up -d --build
```

### 3b. On a new VM

A small Debian or Ubuntu VM is enough. Planning envelope from
`docs/architecture/deployment.md` — estimates, not measured requirements:

| | CPU | RAM |
|---|---|---|
| app | 0.5–1.5 | 512 MB – 1.5 GB |
| PostgreSQL | 0.5–2 | 512 MB – 2 GB |

Recommended starting point: **2 vCPU, 4 GB RAM, 40 GB disk**. Give the VM
more disk than you think if you plan to keep logical backups on it.

Install Docker Engine with the Compose plugin from Docker's own
repository, add your user to the `docker` group, then follow **3a**.

Build memory is the thing most likely to bite on a small VM — the Next.js
build is the heaviest moment in the lifecycle, not the running app. If the
build is killed, either give the VM temporary swap or build the image
elsewhere and push it to a registry.

---

## 4. Migrations, which are not automatic

**The application does not run migrations at startup.** `instrumentation.ts`
starts the outbox worker and nothing else. The runtime image contains only
the standalone bundle — no `drizzle-kit`, no source, no dev dependencies —
so you cannot run them from the `app` container either.

Run them from a one-off container built from the Dockerfile's `build`
stage, which does have the toolchain. **This is the verified procedure:**

```bash
docker build --target build -t medfamilyos-migrate .
```

```bash
docker run --rm --network med-family-os_app --env-file .env medfamilyos-migrate pnpm db:migrate
```

The network name is `<compose-project>_app` — check it with
`docker network ls` if your directory is named differently. Run this
**after every update, before the new app container serves traffic**.

There are 15 migrations as of this writing. `drizzle-kit migrate` is
idempotent: running it against an up-to-date database applies nothing.

---

## 5. Recommended configuration

### Put a reverse proxy in front of it

`docker-compose.yml` publishes no host port at all — only `expose: 3000`
on the `reverse-proxy` network. That is intentional: the application is
reached through your proxy (Caddy, Traefik, nginx, NPM), not directly.

Terminate TLS at the proxy and give it a real certificate, internal CA or
otherwise. The app sets CSP, `X-Frame-Options` and the other security
headers itself in `proxy.ts`, but it does **not** set HSTS — add
`Strict-Transport-Security` at the proxy if you serve over HTTPS.

The proxy should use:

- `GET /api/health` — liveness. Cheap, no database. Failing means restart.
- `GET /api/ready` — readiness. Executes `select 1`. Returns **503** when
  PostgreSQL is unavailable, so the proxy should stop routing without
  restarting the container.

### Secrets

- Never commit `.env`. It is gitignored, and `.dockerignore` keeps it out
  of the build context as well.
- `CREDENTIAL_KEYS` (used to seal integration credentials) **must not live
  in the database or in a database backup.** Keeping it out is precisely
  what makes a stolen dump useless. Store it with your other
  infrastructure secrets, and make sure your restore drill includes
  recovering it — a restored database with no key is unreadable
  integration configuration.
- `HA_READONLY_TOKEN` must be at least 32 characters. Leaving it unset
  **disables** `/api/ha/summary` rather than opening it.

### Home Assistant

Expose only `GET /api/ha/summary`, authenticated with
`HA_READONLY_TOKEN`. Do not give Home Assistant database access. The
endpoint is a deliberately narrow read-only projection — counts and
titles — and never carries secrets, health details, children's data,
document contents or transaction-level finance.

### The assistant (optional)

Leave `ASSISTANT_*` unset and the AI surfaces do not exist. If you want
them, any server speaking the OpenAI chat-completions shape works —
Ollama, llama.cpp, LM Studio, vLLM, LocalAI:

```dotenv
ASSISTANT_BASE_URL=http://ollama.internal:11434
ASSISTANT_MODEL=llama3.1:8b
ASSISTANT_LOCALITY=LOCAL
```

`ASSISTANT_LOCALITY` has **no default and is never inferred from the
hostname**. `LOCAL` may be shown NORMAL and SENSITIVE records; `REMOTE`
may be shown NORMAL only. Nothing marked HIGHLY_SENSITIVE goes to either.
Getting this wrong is a data leak rather than a misconfiguration, which is
why it must be stated explicitly.

Cold starts on a local model can be slow. `ASSISTANT_TIMEOUT_MS` defaults
to 120 s for that reason.

### Background work

One instance should process the outbox. If you ever run a second
container, set `OUTBOX_WORKER_ENABLED=false` on all but one — the same
switch also stops the reminder scan and the sync scheduler.

---

## 6. Updating

```bash
git pull
docker compose build
docker build --target build -t medfamilyos-migrate .
docker run --rm --network med-family-os_app --env-file .env medfamilyos-migrate pnpm db:migrate
docker compose up -d
```

Rebuild periodically even without code changes. The Dockerfile runs
`apt-get upgrade` at build time on purpose: the base tag is only as fresh
as the last time it was rebuilt, and this is how a patched library
actually reaches the image.

---

## 7. Backups

Details in [`docs/backup/backup-restore.md`](backup/backup-restore.md).
The short version:

```bash
docker compose exec -T db pg_dump -U medfamily medfamily | gzip > medfamily-$(date +%F).sql.gz
```

Assume a backup will eventually be read by someone who should not have it:
encrypt it at rest, and keep `CREDENTIAL_KEYS` somewhere else entirely.

Target RPO 24 h / RTO 4 h, and run a real restore drill quarterly — a
backup nobody has restored is a hypothesis, not a backup. The drill is:
clean PostgreSQL → restore → migrate → start → verify records and
permissions → record how long it took.

---

## 8. Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm test:e2e
```

E2E needs a database and builds the standalone bundle, which is the same
artifact the Dockerfile runs — that is deliberate, so the tests exercise
what actually ships rather than `next start`.

```bash
pnpm scan
```

Scans dependencies and the built image for known advisories.

---

## Known rough edges

- **`APP_URL` in `.env.example` is not read by any code.** It appears in
  the example file and in CI, but nothing consumes it. Set it or don't; it
  currently has no effect. Auth.js runs with `trustHost: true` and derives
  the origin from the request.
- **Migrations are a manual step** (§4). There is no startup migration and
  no `migrate` service in the compose file.
- **There is no password reset flow.** No mail server is assumed, so
  recovery for a lost owner password means editing the database.
