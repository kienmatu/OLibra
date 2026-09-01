# OLibra — Deployment

**Status:** STALE — describes the Next.js deployment (VPS, Docker, Caddy),
which is not what ships. The Laravel app targets shared cPanel hosting; its
pipeline exists (`.github/workflows/deploy-laravel.yml`, `.cpanel.yml`,
`deploy/post-deploy.sh`) and has never been run against the real host. This
document will be rewritten from the first real deploy, not before it.
**Scope:** Standing this system up on a VPS and keeping it running. The reasoning behind the design is in [`superpowers/specs/2026-08-14-vps-deployment-design.md`](superpowers/specs/2026-08-14-vps-deployment-design.md); this document is the operator's half — what to type, in what order, and what to do when it does not work.

Everything here assumes one VPS running Ubuntu 22.04 or 24.04 with 2 GB of RAM.

---

## 1. What you need before starting

| | |
|---|---|
| **A VPS** | 2 GB RAM minimum, 20 GB disk, Ubuntu 22.04 or 24.04. Root SSH access. |
| **A domain** | Any apex domain you control, e.g. `olibra.example`. |
| **Two DNS A records** | `<domain>` and `storage.<domain>`, both pointing at the VPS's IP. |

**The second DNS record is not optional.** Every cover, avatar and condition photograph is an `<img>` tag pointing at `https://storage.<domain>`. Without it the application works perfectly and every image on the site is broken, with nothing in the server log to say why.

Set both records **before** the first deploy. Caddy requests certificates for both hostnames on first start, and a record that does not resolve yet means a certificate that does not issue.

---

## 2. First deploy

### 2.1 Prepare the host

As **root** on the fresh VPS:

```bash
git clone https://github.com/kienmatu/OLibra.git /tmp/olibra-bootstrap
```

Read the plan before you let it do anything — it installs packages, edits `/etc/fstab`, and closes a firewall on a machine you may only be able to reach through that firewall:

```bash
/tmp/olibra-bootstrap/scripts/ops/bootstrap-vps.sh
```

That prints what it will change and exits without changing it. When the plan looks right:

```bash
/tmp/olibra-bootstrap/scripts/ops/bootstrap-vps.sh --yes
```

It creates a `deploy` user, installs Docker, creates the 2 GB swapfile the build needs, configures log rotation, fail2ban, unattended upgrades and the timezone, installs the nightly backup entry, and enables `ufw` last.

> **If you connect over SSH on a port other than 22**, pass `--no-firewall` and add your port to `ufw` by hand afterwards. The script warns about this and asks before proceeding, but a warning you have already agreed to is easy to miss.

### 2.2 Clone the repository as the deploy user

Log out, and back in as `deploy` — the docker group membership only takes effect on a new login:

```bash
ssh deploy@<vps-ip>
```

```bash
git clone https://github.com/kienmatu/OLibra.git ~/olibra && cd ~/olibra
```

The path matters: the nightly backup cron entry the bootstrap installed assumes `~/olibra`. If you clone somewhere else, edit it with `crontab -e`.

### 2.3 Create `.env.prod`

```bash
cp .env.prod.example .env.prod
```

Generate a value for each of the four secrets — run this once per secret and paste the result in:

```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo
```

The `tr` is not decoration. `DATABASE_URL` and `MIGRATION_DATABASE_URL` are assembled from these values inside `compose.prod.yaml`, and a `/`, `+` or `@` in a password breaks a `postgres://` URL — surfacing as an authentication failure, which is the least informative possible symptom for a password that is in fact correct.

Fill in:

| Variable | |
|---|---|
| `POSTGRES_PASSWORD` | The `olibra` superuser. |
| `OLIBRA_POOL_PASSWORD` | The `olibra_pool` role the application actually connects as. |
| `S3_ACCESS_KEY_ID` | Becomes MinIO's root user. |
| `S3_SECRET_ACCESS_KEY` | At least 8 characters, or MinIO refuses to start. |
| `ACME_EMAIL` | Optional. Where Let's Encrypt sends expiry warnings. |

**Never put a comment on the same line as a value.** Compose keeps everything after `=`, comment included. `.env.example` once did this and set the superuser's real password to the sentence explaining that the password was required — and Postgres started and accepted it. `deploy.sh`'s preflight rejects any secret containing `#` for this reason.

Leave `APP_DOMAIN` as `CHANGE_ME`; the next step writes it.

### 2.4 Deploy

```bash
./deploy.sh --domain olibra.example
```

The first run takes 5–15 minutes: it builds the image from scratch, runs every migration against an empty database, and waits for Caddy to obtain two certificates.

`--domain` writes `APP_DOMAIN` into `.env.prod`, so subsequent deploys need only `./deploy.sh`.

### 2.5 Seed the first administrator

The database is migrated but empty — there is no account to sign in with yet.

```bash
docker compose -f compose.prod.yaml --env-file .env.prod run --rm migrate bun run db:seed
```

Read `src/db/seed-cli.ts` before running this on a system that already has real data in it; the seed is written for a fresh database.

---

## 3. Routine deploys

```bash
cd ~/olibra && ./deploy.sh
```

**Expect two to five minutes of downtime.** On a 2 GB box you cannot both build the image in place and keep serving — `next build` peaks near 2 GB while Postgres and MinIO already hold about 400 MB, so `deploy.sh` stops `app` and `sweep` to make room. This is a deliberate trade, not a defect; §3.1 of the design document argues it.

| Command | |
|---|---|
| `./deploy.sh` | The full sequence. |
| `./deploy.sh --service app` | Rebuild and restart the application only. |
| `./deploy.sh --migrate-only` | Apply migrations, change nothing else. |
| `./deploy.sh --no-build` | Restart using the current image. For a prebuilt image, or a config-only change. |
| `./deploy.sh --no-backup` | Skip the pre-deploy dump. Think first. |

### What a deploy does

```
1. preflight        eight checks; nothing has changed yet
2. git pull
3. backup           pg_dump BEFORE anything moves
4. up db + storage  wait for both healthchecks
5. stop app, sweep  frees ~700 MB for the build
6. build
7. migrate          new image, superuser credential; failure aborts here
8. up               everything
9. verify           container health AND an HTTPS probe from outside
```

Step 3 runs before step 7 because a migration is the one deploy step that can destroy the records — children's names, dates of birth, parents' names. The dump is measured in megabytes and takes seconds.

**If step 7 fails, `app` and `sweep` stay stopped.** That is the honest outcome, not a bug: the new image is untrustworthy and the old one may disagree with a partially applied schema. Fix the migration and run `./deploy.sh --migrate-only`, or restore (§5.2).

---

## 4. Day-to-day

### Logs

```bash
docker compose -f compose.prod.yaml --env-file .env.prod logs -f app
```

Swap `app` for `caddy`, `db`, `storage` or `sweep`. Caddy also writes access logs inside its container at `/var/log/caddy/`.

### Container status

```bash
docker compose -f compose.prod.yaml --env-file .env.prod ps
```

### A psql session

Postgres is bound to `127.0.0.1` and is not reachable from the internet. From your own machine:

```bash
ssh -L 5435:localhost:5435 deploy@<vps-ip>
```

Then, in another terminal:

```bash
psql postgres://olibra:<POSTGRES_PASSWORD>@localhost:5435/olibra
```

### MinIO's console

Deliberately not exposed — no published port, and no Caddy route. It is a login form for the root credentials, which also hold every child's photograph.

Reaching it takes two steps, because `ssh -L 9001:localhost:9001` will not work: there is nothing listening on the VPS's own loopback. SSH can forward to any address the VPS can reach, though, and the container's address on the Docker bridge is one.

First, on the VPS, find that address:

```bash
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' olibra-prod-storage-1
```

Then, from your own machine, forward to it:

```bash
ssh -L 9001:172.18.0.3:9001 deploy@<vps-ip> -N
```

Open `http://localhost:9001` and sign in with `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`. Close the tunnel when you are finished — the container address changes when the stack is recreated, so this is a per-session thing rather than something to script.

---

## 5. Backups and restore

### 5.1 Backups

Run automatically before every deploy, and nightly at 03:00 by the cron entry the bootstrap installed.

```bash
./scripts/ops/backup.sh
```

Writes `backups/db/olibra-<UTC timestamp>.dump` (custom format, `chmod 600`) and mirrors the bucket into `backups/storage/`. Keeps the newest 14 dumps.

**`./data/postgres` is not a backup.** Copying a live Postgres data directory catches pages mid-write and produces something that restores as a corrupt cluster — or, worse, as one that starts and is quietly wrong. `compose.yaml`'s header comment says backing up `./data` backs up everything; that is true of MinIO's half only.

> **These files are on the same disk as the data they protect.** They cover a bad migration; they do not cover losing the VPS. Copy them somewhere else periodically:
> ```bash
> rsync -avz deploy@<vps-ip>:~/olibra/backups/ ./olibra-backups/
> ```
> This is a manual step on purpose — automating it means putting a credential for the off-site location on the box being backed up.

### 5.2 Restore

**This deletes everything recorded since the dump was taken.** Prefer fixing the migration and running `./deploy.sh --migrate-only`.

```bash
ls -lt backups/db/
./scripts/ops/restore.sh --yes-destroy-current-data backups/db/olibra-20260814-030000Z.dump
```

The script refuses without the flag, refuses a file that is not a real `pg_dump` archive **before** dropping anything, takes a safety dump of the current database first, stops `app` and `sweep` so nothing writes mid-restore, and verifies the result has tables before restarting anything.

Afterwards, check by hand rather than trusting the exit code:

- Sign in as a known reader.
- Open a bookshelf's catalogue; confirm the book count looks right.
- Open a reader's profile; confirm a date of birth reads correctly.
- Confirm a cover image loads — that is the object store, not the dump.

### 5.3 Rolling back code

```bash
git log --oneline -10
git checkout <previous-commit>
./deploy.sh --no-pull
```

**A code rollback does not roll back a migration.** If the deploy you are undoing applied one, the older code may not understand the newer schema. In that case restore the database from the pre-deploy dump (§5.2) as well.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build output ends in `Killed`, or simply stops | The OOM killer. `next build` did not fit. | `free -m` — if swap is 0, run `sudo ./scripts/ops/bootstrap-vps.sh --yes`. |
| `https://<domain>` does not answer after a deploy | Certificate not issued yet, or DNS not resolving. | `dig +short <domain> storage.<domain>` — both must return the VPS IP. Then `docker compose ... logs caddy`. |
| Every image is broken; pages otherwise fine | `S3_PUBLIC_URL` is wrong, or `storage.<domain>` does not resolve. | `dig +short storage.<domain>`. Then check `docker compose ... config \| grep S3_PUBLIC_URL` reads `https://storage.<domain>`. |
| "Invalid Server Actions request" on any form | `APP_DOMAIN` was not in the build. | It is a **build** arg, not just runtime — rebuild: `./deploy.sh --service app`. |
| App container restarts repeatedly | It cannot reach the database. | `docker compose ... logs app`. Usually `OLIBRA_POOL_PASSWORD` disagreeing with what the migration created, or migrations never having run. |
| `permission denied to set role` in the sweep log | `sweep` is using `DATABASE_URL` instead of the superuser. | Check `compose.prod.yaml` gives `sweep` a `MIGRATION_DATABASE_URL`. |
| `deploy.sh` says a secret "contains a '#'" | A comment on the same line as a value. | Move it to its own line above the variable. |
| Disk full | Old images and build cache. | `docker system prune -af` — it does not touch `./data` or `backups/`. |
| Certificate will not issue, repeatedly | Let's Encrypt rate limit: 5 duplicate certificates per domain per week. | Wait. Do not delete the `caddy-data` volume, which is what usually causes this. |

### The one thing not to do

**Do not delete the `caddy-data` volume** to "reset" TLS. It holds the issued certificates and the ACME account key, and wiping it forces a re-issue against a weekly rate limit — turning a small problem into a week of no HTTPS.

---

## 7. What is deliberately not set up

Named so that their absence is a decision rather than an oversight:

- **Monitoring and alerting.** Nothing notices a box that has been down for a day. `restart: unless-stopped` and the backup cron's mail are the whole of it.
- **Off-site backups.** §5.1's `rsync` is manual.
- **Staging.** One box, one environment. `--service` and the pre-deploy backup stand in for it.
- **Zero-downtime deploys.** Not achievable while building on a 2 GB box. The upgrade path is building the image in CI, pushing to a registry, and deploying with `--no-build`.
