# Prompts for the homelab project: an on-demand VM for Med Family OS

Copy these into your homelab Claude Code session, one at a time, in order.
They are deliberately sequenced so nothing is created before the host has
been looked at.

Two things are built into their wording on purpose:

- **Inspect before deciding.** This project's own `CLAUDE.md` forbids
  inventing CPU, RAM, storage type, reverse proxy, Docker version, network
  ranges or backup target. The same rule should apply to the homelab side.
- **The facts about this app come from here, not from guesswork.** Your
  homelab Claude has never seen Med Family OS. Prompt 0 gives it what it
  needs; the rest reference it.

---

## Prompt 0 — the app's operating requirements

> I am going to ask you to provision a VM for an application called **Med
> Family OS**. You have never seen it. Here is everything you need to know
> about how it runs. Do not act on this message yet — read it, ask me about
> anything that conflicts with what you know about this homelab, and wait.
>
> **What it is:** a private, self-hosted household application. One
> household, a handful of users, all on the local network. It is not
> public-facing.
>
> **Shape:** a Docker Compose project with exactly two services.
> - `app` — Next.js 16 standalone bundle on `node:22-bookworm-slim`,
>   listening on port 3000. It is `expose`d only, never published to the
>   host. It joins an **external** Docker network called `reverse-proxy`.
> - `db` — `postgres:18.6`, pinned exactly. Every table's primary key
>   defaults to PostgreSQL 18's native `uuidv7()`, so an older major will
>   fail and a newer one is untested. It sits on an `internal: true`
>   network with no published port.
>
> **Health endpoints**, both already implemented:
> - `GET /api/health` — liveness. Cheap, touches no database. Failing means
>   restart the container.
> - `GET /api/ready` — readiness. Runs `select 1`. Returns **503** when
>   PostgreSQL is unavailable. A proxy or monitor should stop routing on
>   this without restarting anything.
>
> **State that must survive:** one Docker volume, `postgres-data`. Nothing
> else. The app writes nothing to disk — it runs as an unprivileged user
> and owns none of its own code.
>
> **Resource envelope** (planning estimates from the project's own
> deployment doc, not measurements):
> - app: 0.5–1.5 vCPU, 512 MB – 1.5 GB RAM
> - PostgreSQL: 0.5–2 vCPU, 512 MB – 2 GB RAM
>
> My starting suggestion is **2 vCPU / 4 GB RAM / 40 GB disk**, but treat
> that as a proposal to check against this host, not a requirement.
>
> **The one sizing trap:** the heaviest moment in this application's life
> is not serving traffic, it is `docker compose build` — the Next.js build
> is the memory peak by a wide margin. If the VM is sized for the running
> app it may be killed during a build. Tell me which you would prefer:
> temporary swap on the VM, a larger VM, or building images elsewhere and
> pulling them from a registry.
>
> **Secrets it needs**, as environment variables in a `.env` file on the
> VM, never committed anywhere:
> - `POSTGRES_PASSWORD` and `DATABASE_URL` — the password inside the URL
>   must match `POSTGRES_PASSWORD` exactly
> - `AUTH_SECRET` — session encryption, 32 bytes
> - `CREDENTIAL_KEYS` / `CREDENTIAL_ACTIVE_KEY` — seals external
>   integration credentials. **This must never be stored in the database or
>   in a database backup.** Keeping it separate is precisely what makes a
>   stolen database dump useless. Your backup design has to account for
>   that, and your restore procedure has to include recovering it
>   separately, or a restored database is unreadable.
> - `HA_READONLY_TOKEN` — optional. Leaving it unset *disables*
>   `/api/ha/summary` rather than opening it.
>
> **Migrations are not automatic.** The app does not migrate on startup,
> and the runtime image deliberately contains no migration tool. They are
> run from a one-off container built from the Dockerfile's `build` stage.
> This is the verified procedure, which must run after every update and
> before the new app container serves traffic:
>
> ```
> docker build --target build -t medfamilyos-migrate .
> docker run --rm --network <project>_app --env-file .env medfamilyos-migrate pnpm db:migrate
> ```
>
> Confirm you have read this and tell me anything here that does not fit
> this homelab.

---

## Prompt 1 — inspect and propose, change nothing

> Inspect this homelab and propose — do not create anything yet — a plan
> for a VM to host Med Family OS as described.
>
> Find out and tell me, from the actual host rather than from assumption:
> - the hypervisor and its version, and how VMs are currently created here
> - free CPU, RAM and storage, and which storage pool you would use and why
> - the network segment these VMs live on, and how addresses are assigned
> - which reverse proxy already exists, how services register with it, and
>   whether it can reach a new VM on that segment
> - how existing VMs are backed up, and whether that covers a VM that is
>   powered off much of the time
> - what monitoring already exists and how a new service is added to it
>
> Then propose: VM name, resources, OS image, disk layout, network
> placement, and how it will be reached through the existing proxy.
>
> Flag anything that conflicts with what I told you about the app. Make no
> changes and create nothing until I approve the plan.

---

## Prompt 2 — create the VM, sized for being switched off and on

> The plan is approved. Create the VM.
>
> This VM is **started and stopped on demand** — it will spend a lot of its
> life powered off, and be brought up when the household needs the app.
> That is a requirement, not an afterthought, so build for it:
>
> - **Clean shutdown is mandatory.** PostgreSQL is in this VM. Install and
>   enable the guest agent so the hypervisor performs an ACPI shutdown
>   rather than pulling the virtual power. Verify the guest actually
>   responds to it — a guest agent that is installed but not running looks
>   identical to one that works until the first hard stop corrupts
>   something.
> - **Give the shutdown enough time.** Confirm the hypervisor's shutdown
>   timeout exceeds what Docker needs to stop PostgreSQL cleanly, and tell
>   me both numbers.
> - **Start containers on boot.** Docker's service must be enabled, and
>   both services already carry `restart: unless-stopped`, so a boot should
>   bring the whole stack back with no intervention. Prove this with a real
>   reboot, not by reading the config.
> - **Fix the clock on resume.** This application is built entirely around
>   dates, deadlines and household timezones, and it reads the *process*
>   clock. A VM that resumes with a skewed clock produces wrong answers
>   rather than obvious errors. Ensure time is synchronised at boot and
>   after resume, and show me the evidence it corrects.
> - **No public exposure.** The app publishes no host port. Only the
>   reverse proxy reaches it, and PostgreSQL is reachable from nothing
>   outside the VM.
>
> When it is up, show me: the VM's address, that the guest agent answers,
> that a shutdown and start cycle works cleanly, and that the clock is
> correct after the cycle.

---

## Prompt 3 — deploy the app

> Deploy Med Family OS onto the VM.
>
> - Clone the repository, then follow `docs/GETTING-STARTED.md` §3a in it.
>   That file is the source of truth; if anything I have said contradicts
>   it, the file wins and you should tell me.
> - Generate **fresh** secrets on the VM with `openssl rand -base64 32` —
>   one per variable, never reused, and never copied from a development
>   machine.
> - Delete `docker-compose.override.yml` if it is present. It is a
>   development-only file that publishes PostgreSQL on 5432 and undoes the
>   internal network. It must not exist on this VM.
> - Create the external `reverse-proxy` Docker network if the proxy does
>   not already provide one.
> - Apply migrations using the one-off build-stage container described in
>   Prompt 0, **before** the app serves any traffic.
> - Register the app with the existing reverse proxy, terminating TLS
>   there. The app sets CSP and the other security headers itself but does
>   **not** set HSTS — add `Strict-Transport-Security` at the proxy.
> - Point the proxy's health checking at `/api/ready`, not `/api/health`:
>   ready returns 503 when the database is down, which is the condition
>   that should stop traffic without restarting anything.
>
> Then verify, by doing it rather than by inspection: reach the app through
> the proxy, complete the first-run setup at `/setup` to create the owner
> account, sign out, and sign back in at `/login`.
>
> Store the secrets in the household password manager as you create them.
> Do not paste them into chat, a wiki, or a git repository.

---

## Prompt 4 — the start/stop lifecycle

> Now make starting and stopping this VM a normal, safe household
> operation. Give me a documented way to do each, and handle the
> consequences.
>
> **Some context about what downtime does and does not break**, which I
> have verified in the application's code so you do not have to guess:
>
> - Notifications are **rows in a database table, read inside the app**.
>   There is no email and no push. So a reminder that comes due while the
>   VM is off is not delivered late to somebody's phone — there is nowhere
>   for it to go, and nobody could have read it anyway while the app was
>   down.
> - The reminder scan looks for dates **less than or equal to now**, and
>   records *which* moment it announced rather than a boolean. So on the
>   next boot it **catches up**: everything that came due during the
>   downtime is created at once, and nothing is lost or double-sent.
> - Integration syncs behave the same way — the scheduler checks what is
>   due, so downtime delays a sync rather than skipping it.
>
> The practical consequence is that this application tolerates being
> switched off far better than most. Do not design an elaborate
> wake-on-demand scheme to solve a problem it does not have.
>
> **What downtime does break, and what I want you to handle:**
>
> 1. **Home Assistant.** If HA polls `/api/ha/summary`, every poll fails
>    while the VM is off. Make it degrade to "unavailable" quietly rather
>    than logging errors or firing failure automations. Tell me exactly
>    what you changed on the HA side.
> 2. **Backups cannot run while the VM is off.** Decide with me whether
>    backups run from inside the guest when it happens to be up, or from
>    the hypervisor so they work regardless. Say which, and what the
>    realistic worst-case gap is between backups given a VM that may be off
>    for days.
> 3. **Monitoring will alarm on a VM that is off on purpose.** Whatever
>    monitors this must distinguish "deliberately stopped" from "down".
>    A monitor that cries wolf every evening gets muted, and then it is not
>    a monitor.
>
> Deliver:
> - one command or script to start it, which waits until `/api/ready`
>   returns 200 and then says it is ready — not merely that the VM booted
> - one command or script to stop it, which performs a graceful guest
>   shutdown and refuses to hard-stop
> - a short runbook in the homelab repository covering both, what to do if
>   the app does not come back, and how to restore from backup
>
> Prove the whole cycle end to end: stop it, start it, confirm the app is
> reachable through the proxy, sign in, and confirm the database still has
> its data.

---

## Prompt 5 — hand back the facts

> Write the outcome into the homelab documentation and give me a summary:
> VM name and address, resources actually allocated, storage pool, backup
> arrangement and its worst-case gap, where the secrets live, the start and
> stop commands, and anything you had to decide that I should know about.
>
> List separately anything you could not verify by doing, and say why.

---

## A note on what to do if the homelab Claude pushes back

If it tells you the resource envelope is wrong for this host, or that
powering the VM off conflicts with how backups or monitoring work there,
**believe the host over these prompts**. The numbers in Prompt 0 are the
project's own planning estimates and have never been measured against real
hardware. That is stated plainly in
`docs/architecture/deployment.md`, and it is the reason Prompt 1 asks for
inspection before anything is created.
