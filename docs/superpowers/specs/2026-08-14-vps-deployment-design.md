# Production deployment on a VPS — design

**Date:** 2026-08-14
**Status:** awaiting approval

`README.md`'s status table has said **Deployment: Settled — Docker Compose;
data bind-mounted to `./data` on the host** and **Hosting: Open** since the
stack was chosen. This spec closes the second row. It does not revisit the
first: `compose.yaml` stays exactly what it is — the file every developer runs —
and production gets its own alongside it, for reasons §1 gives.

What ships: a production compose file, a Caddyfile, a deploy script, a one-time
host bootstrap script, a backup/restore pair, and the operator documentation
that makes the restore path something other than a rumour. Four small changes to
files that already exist (§7) close defects that only a public deployment can
expose, and which would each have surfaced on day one.

The reference throughout is `deploy.sh` and `nginx/setup-nginx.sh` from the
Chrony project, which deploy a comparable stack to a comparable box. §9 records
what was taken from them and what was deliberately not.

---

## 1. A separate compose file, not a profile

`compose.yaml` publishes Postgres on `${POSTGRES_PORT:-5435}` and MinIO on
`9000`/`9001` — on every interface, not loopback — carries a `db-test` service,
and defaults `S3_PUBLIC_URL` to `http://localhost:9000`. Every one of those is
correct for the machine it was written for and wrong for a public one.

The alternative considered was a `prod` profile inside the existing file. It was
rejected because a profile does not let a service *change* — `db`'s port mapping
and `app`'s environment would have to be right for both worlds simultaneously,
and the failure mode of getting that wrong is a Postgres superuser reachable
from the internet. A second file makes the production stack something you read
in one piece, and makes `docker compose up -d` on a developer's machine
incapable of meaning the production thing by accident.

So: **`compose.prod.yaml`**, invoked as an array the way Chrony's script does
it, so no later call can drift onto the wrong env file:

```bash
COMPOSE=(docker compose -f compose.prod.yaml --env-file .env.prod)
```

### 1.1 Services

| Service | Image | Published ports | `restart` |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | `80`, `443`, `443/udp` | `unless-stopped` |
| `app` | built from `Dockerfile`, `target: runner` | none | `unless-stopped` |
| `sweep` | same image as `app` | none | `unless-stopped` |
| `db` | `postgres:16.10-alpine` | `127.0.0.1:5435` only | `unless-stopped` |
| `storage` | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | none | `unless-stopped` |
| `storage-init` | `minio/mc` | none | **`"no"`** |
| `migrate` | same image as `app`, `profiles: ["tools"]` | none | **`"no"`** |

**`storage-init` and `migrate` are the exceptions to `restart:
unless-stopped`, and they must stay exceptions.** `storage-init` creates the
bucket, applies the policy, and exits 0 — that is its whole job. `unless-stopped`
does not mean "unless it succeeded"; it restarts a container that exits cleanly
just as readily as one that crashed, so the bucket-init container would spin
forever, re-applying a policy nobody changed, burning a restart slot and filling
the log it would be read from. `compose.yaml` already has `restart: "no"` on this
service for this reason and it carries over verbatim. `migrate` (§1.2) is the
same shape of thing, and additionally sits behind a profile so it is never part
of an ordinary `up`.

Every other service in the table is a long-running process that should come back
after a crash, an OOM kill, or a host reboot — which is the case that matters
most on a box nobody is watching. `unless-stopped` rather than `always` is
deliberate: `docker compose stop app` during a deploy (§4, step 5) must *stay*
stopped until the script says otherwise, and `always` would fight it.

### 1.2 `migrate` is its own service, so `app` can drop the superuser

`compose.yaml` puts **both** `DATABASE_URL` (the `olibra_pool` role) and
`MIGRATION_DATABASE_URL` (the `olibra` superuser) into `app`'s environment,
because `docker compose exec app bun run db:migrate` is how a developer runs
migrations. That is right for a developer machine and wrong for a public one:
the process serving anonymous HTTP requests holds a credential that can create
roles, disable row level security, and read every table regardless of policy.
The whole of CRITICAL 2 — the reason `olibra_pool` exists at all, per
`DATABASE.md` §3 — is that a superuser connection makes every RLS policy in the
project inert.

`compose.prod.yaml` therefore splits it:

| Service | `DATABASE_URL` | `MIGRATION_DATABASE_URL` |
|---|---|---|
| `app` | yes | **no** |
| `sweep` | no | yes — `sweep-cli.ts` needs `set local role olibra_admin` |
| `migrate` | no | yes |

Verified rather than assumed: `MIGRATION_DATABASE_URL` is read in exactly four
places (`migrate-cli.ts`, `seed-cli.ts`, `sweep-cli.ts`, `instrumentation.ts`),
and `instrumentation.ts` — the only one of the four the running server executes
— guards it with `if (!value) continue;` inside
`checkDatabaseUrlsForSwallowedComments()`. Removing the variable from `app`
skips a check that has nothing to check, and breaks nothing.

This is also why §4.3's migration step runs `compose run --rm migrate` rather
than `compose run --rm app`: a `run` against `app` would inherit `app`'s
environment, which is precisely the environment this section removes the
credential from.

### 1.3 Nothing but Caddy is exposed

`app`, `storage` and `sweep` publish no host ports at all. Caddy reaches them
over the compose network by service name (`app:3000`, `storage:9000`), which is
the only address they need to be reachable at.

`db` keeps `127.0.0.1:5435` — loopback only, so it is reachable through an SSH
tunnel for `psql` and nothing else. This is a genuine operational need (reading
the audit log, checking a migration landed) and loopback binding costs nothing.
It is written as `127.0.0.1:5435:5432` in full; `5435:5432` binds `0.0.0.0` and
is the exact mistake this line exists to not make.

**MinIO's console (`9001`) is not published and gets no Caddy route.** It is a
login form for the root credentials that also hold every child's photograph. An
operator who needs it forwards it over SSH:

```bash
ssh -L 9001:localhost:9001 deploy@<vps>   # then docker compose port, or exec
```

### 1.4 Memory limits for a 2 GB box

The target is a 2 GB VPS. Limits are set so the sum leaves headroom rather than
consuming the box, and so that a runaway service is killed rather than taking
the host with it:

| Service | `mem_limit` | Reasoning |
|---|---|---|
| `db` | `512m` | Postgres 16 idles near 100 MB; 512 leaves room for a `pg_dump` and a few concurrent sessions. |
| `storage` | `512m` | MinIO's floor is roughly 256 MB; uploads stream. |
| `app` | `700m` | Next standalone under Bun, serving a shelf of a few hundred books. |
| `sweep` | `128m` | A `sh` loop that runs one query a day. |
| `caddy` | `128m` | A reverse proxy for two hostnames. |

Total ceiling 1.98 GB against 2 GB of RAM plus the 2 GB swapfile §3 requires.
The ceilings are not expected to be reached simultaneously; they exist so that
the one that misbehaves is the one that dies.

---

## 2. Caddy, in compose, for two hostnames

TLS is Caddy's rather than certbot's. The comparison that decided it: Chrony's
`setup-nginx.sh` issues five certificates by hand, downloads a TLS options file
from a GitHub raw URL, generates DH params, and leaves renewal to a systemd
timer that reloads a *host* nginx — which is why that script has to run nginx on
the host rather than in the stack. Caddy renews **in-process**, so the objection
that forces nginx onto the host does not apply, and the stack becomes one
`docker compose up -d` with nothing installed on the box but Docker itself.

```
{$APP_DOMAIN} {
    reverse_proxy app:3000
}

storage.{$APP_DOMAIN} {
    reverse_proxy storage:9000
}
```

Plus security headers, a compression directive, and an access log. That is the
whole file — set against roughly 130 lines of nginx config and a 130-line
issuance script.

**The `caddy_data` volume is load-bearing and must be named in the backup
runbook.** It holds the issued certificates and the ACME account key. Wiping it
is not a free re-issue: Let's Encrypt's rate limit is 5 duplicate certificates
per registered domain per week, and burning it means a week of no TLS.

### 2.1 The storage hostname is not optional

`S3_PUBLIC_URL` is what `ObjectStore.url()` builds the URL a *browser* fetches
from — every cover, every avatar, every condition photograph is an `<img>` tag
pointing at it. `compose.yaml` defaults it to `http://localhost:9000`, which is
right for a developer and, in production, renders every image on the site
broken, with nothing in the server log to say why. The application would be
working perfectly.

So `storage.${APP_DOMAIN}` is a required second DNS A record, and
`.env.prod` sets `S3_PUBLIC_URL=https://storage.${APP_DOMAIN}` — with a
preflight check (§4.1) that refuses to deploy if the value still contains
`localhost`.

`S3_ENDPOINT` stays `http://storage:9000`: the *server* reaches MinIO over the
compose network, and routing its traffic out to the public hostname and back
would be slower, and would break the moment DNS was the thing that was wrong.
The split between the two variables is exactly what `.env.example`'s comment on
`S3_PUBLIC_URL` describes — "differs from `S3_ENDPOINT` whenever the app reaches
storage over the internal network but the browser does not." Production is that
case.

### 2.2 The bucket policy is already correct

`compose.yaml`'s `storage-init` grants `s3:GetObject` and nothing else, written
out as an explicit JSON document rather than `mc anonymous set download`,
because `download` also grants `s3:ListBucket` and an unauthenticated
`GET /<bucket>/?list-type=2` would then enumerate the key of every avatar — and
the avatars are photographs of children. `tests/architecture/compose-grants-only-get-object.test.ts`
byte-compares that document against the one the test suite applies.

**`compose.prod.yaml` reuses that entrypoint verbatim**, and the architecture
test's comparison must be extended to cover the production file too, or the
production bucket is the one copy of that policy nothing checks.

---

## 3. The 2 GB build problem

The chosen path is building on the VPS — `git pull`, `docker compose build`, as
Chrony does. On a 2 GB box that is genuinely tight, and pretending otherwise
produces a bare `Killed` partway through `next build` and a half-deployed
machine.

Measured shape of the problem: `next build` runs under Node in the `builder`
stage (the Dockerfile's opening comment explains why Node and not Bun) and peaks
around 1.5–2 GB on a project this size. `db` and `storage` together idle near
400 MB. The two do not fit.

Three mitigations, each enforced by a script rather than left to be remembered:

1. **A 2 GB swapfile**, created by `bootstrap-vps.sh` (§6) and *verified by
   `deploy.sh`'s preflight*, which refuses to build without it and names the fix
   rather than failing generically. Swap is slow and that is fine — a build is
   not latency-sensitive, and the alternative is not "slower", it is "dead".

2. **`app` and `sweep` are stopped before the build and started after it**
   (§4, step 5). This frees roughly 700 MB at precisely the moment the build
   needs it. `db` and `storage` stay up, because step 7's migration needs the
   database and stopping them buys only ~400 MB at the cost of a longer outage.

3. **`NODE_OPTIONS=--max-old-space-size=1536`** passed as a build arg, so Node's
   own heap ceiling sits below the box's real ceiling. The difference is between
   a JavaScript heap-out-of-memory stack trace naming the phase that failed, and
   the kernel's OOM killer removing the process with no message at all.

### 3.1 The cost, stated rather than hidden

**Deploys have two to five minutes of downtime.** Zero downtime, building on the
box, and 2 GB of RAM are three constraints of which any two are satisfiable. For
a parish bookshelf that a few volunteers use during opening hours this is the
right trade, and pretending a rolling deploy is available here would produce a
script that is more complicated *and* still goes down.

The upgrade path is deliberately left open and costs no rewrite: build the image
in GitHub Actions, push to GHCR, and run `./deploy.sh --no-build`, which pulls
instead. `--no-build` exists in the first script for this reason, and is the
same idea as Chrony's `--no-pull` ("useful when deploying from a CI artifact").

---

## 4. `deploy.sh`

```
Usage: ./deploy.sh [--domain <d>] [--no-pull] [--no-build] [--no-backup]
                   [--service <name>] [--migrate-only] [-h|--help]
```

### 4.1 Preflight, before anything changes

Chrony's script checks four things before it acts; this one checks eight,
because the extra four are each a failure that would otherwise be discovered
halfway through:

| Check | Failure message names |
|---|---|
| `.env.prod` exists | copy `.env.prod.example` and fill it in |
| `compose.prod.yaml` exists | — |
| `docker` on PATH and daemon responding | — |
| `APP_DOMAIN` set and not a placeholder | pass `--domain`, or set it in `.env.prod` |
| `S3_PUBLIC_URL` contains no `localhost` | the broken-images failure, §2.1 |
| Required secrets non-empty and not `CHANGE_ME` | `POSTGRES_PASSWORD`, `OLIBRA_POOL_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Swap ≥ 1 GB, unless `--no-build` | run `scripts/ops/bootstrap-vps.sh`, §3 |
| Free disk ≥ 5 GB | a Docker build that fills the disk corrupts the image store |

The secret check is worth its line specifically because of what `.env.example`
records at length: an inline comment after `POSTGRES_PASSWORD=` once became the
password's actual value, spaces and sentence included, and Postgres started and
accepted it. A guard that only rejects *empty* is not enough; this one also
rejects `CHANGE_ME` and any value containing `#`.

### 4.2 The domain, on first deploy or by flag

`APP_DOMAIN` lives in `.env.prod`. `--domain <d>` overrides it for the run, and
— when `.env.prod` has no `APP_DOMAIN` line at all — **writes it in**, so the
first deploy is the only one that needs the flag. A domain that differs from the
stored one prompts before overwriting, since changing it re-issues certificates
and changes every stored image URL's host.

Nothing anywhere is hardcoded to a domain. Chrony's `setup-nginx.sh` carries a
five-element `DOMAINS=(...)` array of literal hostnames, which is why it cannot
be used on a second deployment without editing it.

### 4.3 Sequence

The ordering is load-bearing and differs from Chrony's in one structural way:
Chrony has no migration step, and this project cannot deploy without one.

```
1. preflight                     §4.1 — nothing has changed yet
2. git pull --rebase             skipped by --no-pull
3. backup                        pg_dump BEFORE anything moves; skipped by --no-backup
4. up -d db storage              wait for both healthchecks
5. stop app sweep                frees ~700 MB for the build (§3)
6. build                         skipped by --no-build (pull instead)
7. migrate                       compose run --rm migrate
                                 non-zero exit → abort; nothing else moves
8. up -d --remove-orphans        everything
9. verify                        container health AND an HTTP probe through Caddy
```

**Step 3 runs before step 7 and that is the entire point of its position.** The
records in that database are children's names, dates of birth and parents'
names, and a migration is the one deploy step that can destroy them. The backup
is cheap — a `pg_dump -Fc` of a shelf of a few hundred books is measured in
megabytes — and it is the only thing standing between a bad migration and a
parish's records.

**Step 7 builds first and migrates second, not the reverse.** The migration must
run the *new* code's migration set, so it needs the newly built image — which is
why it cannot move earlier in the sequence.

It runs as `compose run --rm migrate`, the one-off service §1.2 defines, rather
than against the long-running `app`. `compose.yaml`'s comment on `app`'s
`MIGRATION_DATABASE_URL` describes the developer form of this — `docker compose
exec app bun run db:migrate` — and production deliberately diverges from it, for
the reason §1.2 gives: `app` does not carry the superuser credential at all here,
so a `run` against `app` would fail with `migrate-cli.ts`'s own
"`MIGRATION_DATABASE_URL` is not set" rather than migrating anything.

On a fresh VPS, step 7 is not optional in a deeper sense than "the schema is
missing": `olibra_pool`, the role `DATABASE_URL` names, is created by
`20260808_13_pool_role.sql`. Until that migration runs, the application cannot
open a connection at all.

**A failed migration leaves `app` and `sweep` stopped.** This is the honest
outcome rather than a bug: the new image is untrustworthy and the old one may
disagree with a partially applied schema. The script says so explicitly, names
the backup file written in step 3, and points at `docs/DEPLOYMENT.md`'s restore
section.

### 4.4 Verification that verifies

Step 9 is two checks, and neither is a log tail.

First, container health, polled from `docker inspect` the way Chrony's
`wait_for_backend_healthy` does — 24 attempts, 5 seconds apart, printing each
attempt so a hang is visible rather than silent.

Then **an HTTP probe through Caddy from outside the stack**:

```bash
curl -fsS "https://${APP_DOMAIN}/" | grep -q "OLibra"
```

This is the only check that exercises DNS, TLS, the Caddy route, the proxy
headers and the application together — the same reasoning the Dockerfile's
`smoke` stage gives for booting the real server and fetching the real landing
page rather than asserting the build produced files.

Chrony's script ends with `timeout 10 docker compose logs -f`, which looks like
verification and establishes nothing: it exits 0 whether the app is serving or
crash-looping. It is not carried over.

### 4.5 `--service`

`./deploy.sh --service app` rebuilds and restarts one service. Chrony's
equivalent runs `build --no-cache`, which for a Next.js image means a full
reinstall and rebuild to restart one container; here it is a plain `build`, so
Docker's layer cache does the job it exists for. `--service` still runs the
preflight and still refuses to skip the health gate.

---

## 5. Backup and restore

**`./data/postgres` is a bind mount, and copying a live Postgres data directory
produces a backup that restores corrupt.** This is worth stating in the spec
because the directory is *right there* and `compose.yaml`'s own header comment —
"Back up that one directory and you have backed up everything" — is true for
MinIO's half and dangerously untrue for Postgres's while the server is running.

`scripts/ops/backup.sh`:

- `pg_dump -Fc` through `docker exec` → `backups/db/olibra-<UTC timestamp>.dump`
- `mc mirror --overwrite` the bucket → `backups/storage/`
- `chmod 600` on the dump, which holds every personal field in the system
- Prune to the last 14 daily backups
- Print the resulting sizes, so a backup that has silently become 0 bytes is visible

Called automatically by `deploy.sh` step 3, and by a host cron entry at 03:00
`Asia/Ho_Chi_Minh`. Host cron rather than a compose service, unlike `sweep`:
`sweep` is application behaviour that belongs with the application, whereas a
backup should not stop happening because the stack it backs up is down —
although, `pg_dump` needing a live server, it will fail in that case and the
cron mail is the notification.

`scripts/ops/restore.sh` takes a dump path, requires an explicit
`--yes-destroy-current-data`, stops `app` and `sweep` first so nothing writes
during the restore, and refuses to run against a database it cannot first back
up. `docs/DEPLOYMENT.md` walks the whole path, because a restore procedure
nobody has read is not a restore procedure.

---

## 6. `scripts/ops/bootstrap-vps.sh`

One-time host preparation, run once as root on a fresh Ubuntu box, idempotent so
re-running is harmless. It prints every change it intends to make and requires
`--yes` to proceed, because it edits firewall and SSH configuration on a machine
that may be reached only through that firewall and that SSH.

- A non-root `deploy` user in the `docker` group
- Docker Engine + the compose plugin, from Docker's own apt repository
- **A 2 GB swapfile** at `/swapfile`, `vm.swappiness=10`, persisted in `/etc/fstab` — §3's first mitigation
- `ufw`: 22, 80, 443 in; everything else denied. Applied last, and it prints the SSH-lockout warning before it does
- `fail2ban` with the default sshd jail
- `unattended-upgrades` for security patches
- `timedatectl set-timezone Asia/Ho_Chi_Minh`, matching the `TZ` every service already sets
- A cron entry for §5's nightly backup

It deliberately does **not** create the `.env.prod` file or generate secrets.
Writing passwords from a script means they exist in a shell history and a script
log; the operator generates them with `openssl rand` and pastes them in, and
`docs/DEPLOYMENT.md` gives the exact commands.

---

## 7. Four changes to existing files

Each is a defect that only a public deployment exposes, and each would surface
on the first day.

### 7.1 `next.config.ts` — Server Actions origin

```ts
allowedOrigins: ["localhost:3001", "*.devtunnels.ms"],
```

The comment above it already anticipates this spec: *"Revisit if a real public
deployment, distinct from this local/QA compose stack, is ever stood up."*

Next compares a Server Action request's `Origin` against `x-forwarded-host` and
aborts with "Invalid Server Actions request" on a mismatch. **Every form in the
application is a Server Action** — sign-in, registration, lending, returning,
every approval queue. If this check misses, the site renders perfectly and
nothing can be submitted.

Caddy's `reverse_proxy` does set `X-Forwarded-Host`, so the check would most
likely pass on its own. "Most likely" is not a good enough property for the
thing that decides whether a volunteer can lend a book, so the production domain
is added explicitly, read from the environment:

```ts
allowedOrigins: [
  "localhost:3001",
  "*.devtunnels.ms",
  ...(process.env.APP_DOMAIN ? [process.env.APP_DOMAIN] : []),
],
```

`APP_DOMAIN` is therefore passed to the **builder** stage as a build arg, not
only to the runtime — `next.config.ts` is evaluated at build time.

### 7.2 A healthcheck for `app`

The Dockerfile says, on the `runner` stage:

> No HEALTHCHECK here — compose owns it, so the check and the dependency
> ordering live in one file rather than two.

`compose.yaml` then defines no healthcheck for `app`. The intent is sound and
the other half was never written, which means `depends_on: {app: {condition:
service_healthy}}` is unavailable and §4.4's health gate has nothing to read.

`compose.prod.yaml` defines one. It probes with `bun -e` rather than `curl` or
`wget`: `oven/bun`'s image is not guaranteed to carry either, and a healthcheck
whose binary is missing reports `unhealthy` forever — a failure that looks
exactly like the application being broken.

```yaml
healthcheck:
  test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

Adding it to `compose.yaml` as well is out of scope here but worth a follow-up:
the developer stack has the same gap.

### 7.3 The architecture test covering the bucket policy

`tests/architecture/compose-grants-only-get-object.test.ts` byte-compares
`compose.yaml`'s policy document against `tests/support/bucket-policy.ts`. Its
own comment records why it exists: two hand-maintained copies drifted, and the
suite was green because it applied its own narrower policy and never used what
shipped.

`compose.prod.yaml` introduces a third copy — of the one policy that guards real
photographs of real children. The test is extended to cover both files.

### 7.4 The inline-comment test must cover `.env.prod.example`

`tests/architecture/env-example-has-no-inline-comments.test.ts` reads exactly
one path — `readFileSync(".env.example", "utf8")` — and counts lines that hand a
trailing comment out as a variable's value. It exists because six variables in
that file once did, and one of them set the Postgres superuser's real password to
a sentence about how the password was required.

`.env.prod.example` is a second file with the identical hazard and, being the
production one, a worse blast radius. It is added to the same test rather than
given its own, so the two files cannot drift into disagreeing about the rule.

The test is currently written around a single filename; extending it means
looping over a list. That is a small change and it is part of this work, not a
follow-up — shipping the production template unguarded would recreate, in
production, the exact defect the test was written for.

---

## 8. `.env.prod.example`

Modelled on `.env.example`, minus everything under its `# ── Tests ──` heading,
plus `APP_DOMAIN`. It inherits that file's hard-won convention, which is worth
restating because it caused a real incident: **every explanatory comment sits on
its own line, never after a value.** Compose keeps everything after `=` in a
`.env` file, comment included, so a trailing note becomes part of the password.

Values requiring generation carry the command that generates them, on their own
comment lines:

```
# openssl rand -base64 32
POSTGRES_PASSWORD=
```

`DATABASE_URL` and `MIGRATION_DATABASE_URL` are written by hand with the
passwords repeated, because dotenv does not expand `${VAR}` inside the file —
the same duplication `.env.example` already carries and explains. `src/instrumentation.ts`
refuses to start if `DATABASE_URL`'s password looks like a swallowed comment,
which is the backstop for getting this wrong.

---

## 9. Inherited from Chrony, and rejected

**Taken:** the `set -euo pipefail` opening; the coloured
`info`/`success`/`warn`/`error` helpers; the preflight-before-action structure;
the `COMPOSE=(...)` array so no call can drift onto the wrong env file;
`--service` for a single-service redeploy; `--no-pull` for deploying from an
artifact; `get_env_value` for reading a key out of the env file without
sourcing it; the health-poll loop that prints each attempt; and `--help` output
that is the file's own header comment.

**Rejected:**

| Not carried over | Why |
|---|---|
| `--backup-users` / `--restore-users` | 250 lines of SQL solving a seeded-user collision this project does not have. The general problem — protecting the data across a deploy — is solved by §5's `pg_dump` instead, which covers every table rather than one. |
| `build --no-cache` on `--service` | A full dependency reinstall and Next build to restart one container. On a 2 GB box it is also the most likely single command to OOM. |
| `timeout 10 docker compose logs -f` as the final step | Exits 0 whether the application is serving or crash-looping. Replaced by §4.4's two real checks. |
| Publishing the app port on `0.0.0.0` | Chrony's compose publishes `8080:8080` and `3000:3000` while nginx proxies to `127.0.0.1` — so the ports are world-reachable for no reason. Here, only Caddy publishes anything. |
| A hardcoded `DOMAINS=(...)` array | §4.2: everything is `${APP_DOMAIN}`. |
| Native nginx + certbot on the host | §2: Caddy renews in-process, which removes the reason nginx has to live outside the stack. |

---

## 10. What this spec does not decide

- **Monitoring and alerting.** Nothing here notices a box that has been down for
  a day. `restart: unless-stopped` and the nightly backup's cron mail are the
  whole of it. An uptime check is a reasonable follow-up and is not this.
- **Log rotation.** Docker's default `json-file` driver grows without bound.
  Setting `max-size`/`max-file` in `/etc/docker/daemon.json` belongs in
  `bootstrap-vps.sh` and is included there, but no aggregation or retention
  policy beyond that is designed.
- **Off-site backups.** §5 writes to `backups/` on the same disk as `./data`,
  which protects against a bad migration and not against losing the VPS. Copying
  those files somewhere else is a documented manual step, not an automated one.
- **Staging.** One box, one environment. The `--service` flag and the pre-deploy
  backup are what stand in for it.
- **Multi-shelf scaling.** The memory limits in §1.3 are sized for a few hundred
  books and a handful of concurrent volunteers, which is what
  `BUSINESS-REQUIREMENTS.md` describes. Nothing here is designed for more.
