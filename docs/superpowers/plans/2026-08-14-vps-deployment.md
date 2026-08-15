# VPS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy OLibra to a 2 GB VPS with one command, over HTTPS, with migrations, backups and a verified health gate.

**Architecture:** A production compose file separate from the developer one, fronted by Caddy in-stack (automatic TLS, renews in-process). Nothing but Caddy publishes a port. `deploy.sh` orchestrates pull → backup → build → migrate → up → verify, stopping `app`/`sweep` before the build so `next build` fits in 2 GB.

**Tech Stack:** Docker Compose, Caddy 2, PostgreSQL 16, MinIO, Bun/Next.js 16, Bash, vitest (for the architecture tests that guard the new config files).

**Spec:** [`docs/superpowers/specs/2026-08-14-vps-deployment-design.md`](../specs/2026-08-14-vps-deployment-design.md)

## Global Constraints

- **Timezone is `Asia/Ho_Chi_Minh` everywhere** — every service sets `TZ`, per BR §4.
- **`restart: unless-stopped` on every long-running service.** The only exceptions are `storage-init` and `migrate`, which are one-shots and must be `restart: "no"` — `unless-stopped` restarts a container that exits 0.
- **Only `caddy` publishes ports.** `db` publishes `127.0.0.1:5435:5432` (loopback, written in full — `5435:5432` binds `0.0.0.0`). `app`, `storage`, `sweep`, `migrate` publish nothing.
- **`app` must not carry `MIGRATION_DATABASE_URL`.** That is the `olibra` superuser; a superuser connection makes every RLS policy inert (DATABASE.md §3).
- **Bucket policy: `s3:GetObject` only**, written as an explicit JSON document with `mc anonymous set-json`. Never `mc anonymous set download` — it also grants `s3:ListBucket`, which enumerates every child's avatar key.
- **No comment may trail a value in any `.env*` file.** Compose keeps everything after `=`, comment included. Comments go on their own line above the variable.
- **Memory ceilings:** `db` 512m, `storage` 512m, `app` 700m, `sweep` 128m, `caddy` 128m. Total 1.98 GB against 2 GB + 2 GB swap.
- **Bash scripts:** `#!/usr/bin/env bash` and `set -euo pipefail` on every one.
- **Image pins are exact**, matching `compose.yaml`: `postgres:16.10-alpine`, `minio/minio:RELEASE.2025-04-22T22-12-26Z`, `minio/mc:RELEASE.2025-04-16T18-13-26Z`.

## Addendum to the spec

Two items surfaced while reading the test suite to write this plan. Both are in scope; the spec's §7 says "four changes to existing files" and is now five:

1. **`Dockerfile` needs `ARG APP_DOMAIN` in the `builder` stage.** §7.1 requires `next.config.ts` to read `process.env.APP_DOMAIN`, and `next.config.ts` is evaluated during `next build` — so the value must reach the builder, not just the runtime. The spec asserted the build arg without noting the Dockerfile edit it implies. Task 3.
2. **Two more architecture tests read `compose.yaml` by name** beyond the two §7 identifies: `compose-pins-datestyle.test.ts` and `compose-supplies-storage-env.test.ts`. Production Postgres inheriting `ISO, MDY` would store 2 April 2015 as 2015-02-03 — a child's date of birth, wrong, silently. Both are extended in Task 2.

## File Structure

| File | Responsibility |
|---|---|
| `.env.prod.example` | Production env template. No inline comments. |
| `compose.prod.yaml` | The production stack: caddy, app, sweep, db, storage, storage-init, migrate. |
| `Caddyfile` | Two hostnames, automatic TLS, security headers. |
| `deploy.sh` | Preflight → pull → backup → build → migrate → up → verify. |
| `scripts/ops/backup.sh` | `pg_dump -Fc` + `mc mirror`, 14-day retention. |
| `scripts/ops/restore.sh` | The other half. Refuses to run without an explicit destroy flag. |
| `scripts/ops/bootstrap-vps.sh` | One-time host prep: user, docker, swap, ufw, fail2ban, cron. |
| `docs/DEPLOYMENT.md` | The operator runbook, including the restore walkthrough. |
| `tests/architecture/*.test.ts` (4 modified) | Guard the production config the same way the developer config is guarded. |
| `next.config.ts` (modified) | `allowedOrigins` gains the production domain. |
| `Dockerfile` (modified) | `ARG APP_DOMAIN` in `builder`. |

---

### Task 1: `.env.prod.example`, guarded by the inline-comment test

**Files:**
- Create: `.env.prod.example`
- Modify: `tests/architecture/env-example-has-no-inline-comments.test.ts:46-53`

**Interfaces:**
- Produces: the variable names every later task reads — `APP_DOMAIN`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `OLIBRA_POOL_PASSWORD`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `TZ`.

- [ ] **Step 1: Extend the test to loop over both files**

Replace the body of the first test in `tests/architecture/env-example-has-no-inline-comments.test.ts` (lines 46–53) with:

```ts
/**
 * Both templates, not just `.env.example`.
 *
 * `.env.prod.example` (2026-08-14, VPS deployment) carries the identical
 * hazard with a worse blast radius: it is the file an operator copies to make
 * the *production* `.env`, so a swallowed comment there sets the real
 * superuser password of the machine holding real readers' records. The list
 * is a list precisely so a third template cannot be added without this test
 * being the thing that notices.
 */
const TEMPLATES = [".env.example", ".env.prod.example"];

test.each(TEMPLATES)(
  "no line in %s hands out a trailing comment as a variable's value",
  (template) => {
    const contents = readFileSync(template, "utf8");
    const lines = contents.split("\n");

    const offenders = lines.filter((line) => /^[A-Z0-9_]+=\s*#/.test(line));

    expect(offenders).toEqual([]);
  },
);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
bun run test -- tests/architecture/env-example-has-no-inline-comments.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.env.prod.example'`. The `.env.example` case still passes.

- [ ] **Step 3: Create `.env.prod.example`**

Every comment on its own line. No value is filled in for a secret.

```bash
# Copy to .env.prod on the VPS and fill in. Never commit .env.prod.
#
# Generate each secret with:
#
#   openssl rand -base64 32 | tr -d '/+=' | head -c 32
#
# The `tr` matters: a `/` or `+` inside a password breaks the
# postgres:// URLs below, which are written by hand rather than composed.

# ── Domain ───────────────────────────────────────────────────────────────────
# The apex domain this deployment serves. `storage.<this>` must also resolve
# here — it is where a browser fetches every cover and avatar from.
#
# `./deploy.sh --domain <d>` writes this line on the first deploy, so it may be
# left as-is until then. The preflight refuses to run while it says CHANGE_ME.
APP_DOMAIN=CHANGE_ME

# ── PostgreSQL ───────────────────────────────────────────────────────────────
POSTGRES_DB=olibra
POSTGRES_USER=olibra

# Required. The `olibra` superuser's password.
POSTGRES_PASSWORD=

# Loopback only. Reachable over an SSH tunnel for psql, never from outside.
POSTGRES_PORT=5435

# Required. The password for `olibra_pool`, the non-superuser role the
# application actually connects as — every RLS policy in the project is inert
# on a superuser connection (DATABASE.md §3). Created by
# 20260808_13_pool_role.sql when `./deploy.sh` runs the migration.
OLIBRA_POOL_PASSWORD=

# ── Object storage ───────────────────────────────────────────────────────────
S3_REGION=us-east-1
S3_BUCKET=olibra

# Required. Becomes MinIO's root user.
S3_ACCESS_KEY_ID=

# Required, at least 8 characters for MinIO.
S3_SECRET_ACCESS_KEY=

S3_FORCE_PATH_STYLE=true

# S3_ENDPOINT and S3_PUBLIC_URL are NOT set here. compose.prod.yaml derives
# both: the server reaches MinIO at http://storage:9000 over the compose
# network, and a browser fetches from https://storage.${APP_DOMAIN}. Setting
# them by hand is how one of them ends up saying localhost, which renders every
# image on the site broken with nothing in the log to say why.

# ── Locale ───────────────────────────────────────────────────────────────────
TZ=Asia/Ho_Chi_Minh
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun run test -- tests/architecture/env-example-has-no-inline-comments.test.ts
```

Expected: PASS, 3 tests (two `test.each` cases plus the guard's own guard).

- [ ] **Step 5: Confirm `.env.prod` itself is gitignored**

```bash
grep -n "env" .gitignore
```

If `.env.prod` is not covered by an existing pattern, add `.env.prod` to `.gitignore`. `.env.prod.example` must remain tracked.

- [ ] **Step 6: Commit**

```bash
git add .env.prod.example tests/architecture/env-example-has-no-inline-comments.test.ts .gitignore
git commit -m "feat: production env template, under the same inline-comment guard as .env.example"
```

---

### Task 2: `compose.prod.yaml`, guarded by three architecture tests

**Files:**
- Create: `compose.prod.yaml`
- Modify: `tests/architecture/compose-grants-only-get-object.test.ts:30-77`
- Modify: `tests/architecture/compose-pins-datestyle.test.ts:33-41`
- Modify: `tests/architecture/compose-supplies-storage-env.test.ts:63-70`

**Interfaces:**
- Consumes: every variable Task 1 defines.
- Produces: service names `caddy`, `app`, `sweep`, `db`, `storage`, `storage-init`, `migrate`; image tag `olibra-app:prod`; volumes `caddy-data`, `caddy-config`. `deploy.sh` (Task 5) calls `docker compose -f compose.prod.yaml --env-file .env.prod run --rm migrate`.

- [ ] **Step 1: Parameterise the bucket-policy test over both compose files**

In `tests/architecture/compose-grants-only-get-object.test.ts`, replace lines 30–77 (the `COMPOSE`/`COMPOSE_CODE` constants and the first two tests; leave the third test, "the shared policy grants s3:GetObject and nothing else", exactly as it is) with:

```ts
/**
 * Both compose files, not just the developer one.
 *
 * `compose.prod.yaml` (2026-08-14) introduces a *third* copy of this policy
 * document — and it is the copy that guards the real bucket, holding real
 * photographs of real children. The original hole this test was written for
 * was two hand-maintained copies drifting; a third, unchecked, is the same
 * hole with the production side unguarded.
 */
const COMPOSE_FILES = ["compose.yaml", "compose.prod.yaml"];

/**
 * A compose file with its comment lines removed.
 *
 * The comments explain at length why `mc anonymous set download` is forbidden,
 * naming it in order to forbid it, and a check for the shorthand's absence that
 * read the raw file would trip on its own rationale — the same incentive
 * `stripCommentsAndStrings` exists to avoid in the architecture tests: never
 * make explaining a rule a way to break it. YAML has one comment form and a `#`
 * inside these files' scalars never begins a line, so a line-level strip is
 * exact here rather than approximate.
 */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/** Compose's own interpolation, left un-substituted in the file on disk. */
const BUCKET_EXPRESSION = "${S3_BUCKET:-olibra}";

test.each(COMPOSE_FILES)(
  "%s's bucket policy is the policy the storage suite applies",
  (file) => {
    const found = code(file).match(/'(\{"Version":.*?\})'/);
    expect(
      found,
      `no bucket policy JSON found in ${file} — the storage-init sidecar ` +
        "must write one out with `mc anonymous set-json`",
    ).not.toBeNull();

    const document = found![1];
    expect(document).toContain(BUCKET_EXPRESSION);

    const bucket = "olibra-test";
    const parsed = JSON.parse(document.replaceAll(BUCKET_EXPRESSION, bucket));

    expect(parsed).toEqual(publicReadPolicy(bucket));
  },
);

test.each(COMPOSE_FILES)(
  "%s does not use the `mc anonymous set` shorthands",
  (file) => {
    // The specific regression. `download` grants `s3:ListBucket` alongside
    // `s3:GetObject`; `public` adds `s3:PutObject` and `s3:DeleteObject` on top
    // of that, which would let anyone on the internet overwrite a child's
    // avatar. Only the explicit document above is allowed, and it is the one
    // the test above compares.
    expect(code(file)).not.toMatch(
      /mc anonymous set\s+(?:download|upload|public)\b/,
    );
    expect(code(file)).toMatch(/mc anonymous set-json\b/);
  },
);
```

- [ ] **Step 2: Parameterise the datestyle test**

In `tests/architecture/compose-pins-datestyle.test.ts`, replace the test at lines 33–41 with:

```ts
/**
 * Both compose files. `compose.prod.yaml` has one Postgres service where
 * `compose.yaml` has two (`db` and `db-test`), so the assertion is
 * "one pin per Postgres service in this file" rather than a fixed count —
 * which is what the original assertion already meant, now that there is a
 * second file for it to mean it about.
 *
 * Production inheriting `ISO, MDY` is this defect at its worst: `02/04/2015`,
 * which is how 2 April 2015 is written in Vietnamese, stored as `2015-02-03`.
 * A child's date of birth, wrong, in the real database, with nothing raised.
 */
test.each(["compose.yaml", "compose.prod.yaml"])(
  "every Postgres service in %s pins DateStyle rather than inheriting the image default",
  (file) => {
    const compose = readFileSync(file, "utf8");

    const postgresServices = compose.match(/image: postgres:/g) ?? [];
    const pins = compose.match(/datestyle=ISO, YMD/gi) ?? [];

    expect(postgresServices.length).toBeGreaterThan(0);
    expect(pins).toHaveLength(postgresServices.length);
  },
);
```

- [ ] **Step 3: Parameterise the storage-env test**

In `tests/architecture/compose-supplies-storage-env.test.ts`, replace the test at lines 63–70 ("compose passes every S3 variable to the app service") with:

```ts
/**
 * Both compose files. A production `app` missing one of the seven is a 500 on
 * the first avatar upload, in the container, which is the worst place to find
 * out — and `S3_PUBLIC_URL` in particular is the one whose absence renders
 * every image on the live site broken while the server logs nothing.
 */
test.each(["compose.yaml", "compose.prod.yaml"])(
  "%s passes every S3 variable to the app service",
  (file) => {
    const service = appService(readFileSync(file, "utf8"));
    const missing = STORAGE_ENV.filter(
      (name) => !new RegExp(`^\\s+${name}:`, "m").test(service),
    );
    expect(missing).toEqual([]);
  },
);
```

- [ ] **Step 4: Run all three to confirm they fail**

```bash
bun run test -- tests/architecture/compose-grants-only-get-object.test.ts tests/architecture/compose-pins-datestyle.test.ts tests/architecture/compose-supplies-storage-env.test.ts
```

Expected: FAIL — `ENOENT ... 'compose.prod.yaml'` on the new cases. Every `compose.yaml` case still passes.

- [ ] **Step 5: Write `compose.prod.yaml`**

Full content in **Appendix A**. Copy it verbatim.

- [ ] **Step 6: Run the three tests to verify they pass**

```bash
bun run test -- tests/architecture/compose-grants-only-get-object.test.ts tests/architecture/compose-pins-datestyle.test.ts tests/architecture/compose-supplies-storage-env.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 7: Validate the compose file resolves**

`docker compose config` interpolates every variable and fails on an unresolvable one, which is the check the tests cannot make.

```bash
cp .env.prod.example /tmp/olibra-config-check.env
sed -i '' 's/^APP_DOMAIN=.*/APP_DOMAIN=example.test/' /tmp/olibra-config-check.env
sed -i '' 's/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=x/' /tmp/olibra-config-check.env
sed -i '' 's/^OLIBRA_POOL_PASSWORD=$/OLIBRA_POOL_PASSWORD=x/' /tmp/olibra-config-check.env
sed -i '' 's/^S3_ACCESS_KEY_ID=$/S3_ACCESS_KEY_ID=x/' /tmp/olibra-config-check.env
sed -i '' 's/^S3_SECRET_ACCESS_KEY=$/S3_SECRET_ACCESS_KEY=xxxxxxxx/' /tmp/olibra-config-check.env
docker compose -f compose.prod.yaml --env-file /tmp/olibra-config-check.env config >/dev/null && echo "compose.prod.yaml resolves"
rm /tmp/olibra-config-check.env
```

Expected: `compose.prod.yaml resolves`. (`sed -i ''` is the macOS form; on Linux use `sed -i`.)

- [ ] **Step 8: Verify `S3_PUBLIC_URL` and the port bindings resolved as intended**

```bash
docker compose -f compose.prod.yaml --env-file /tmp/olibra-config-check.env config 2>/dev/null | grep -E "S3_PUBLIC_URL|S3_ENDPOINT|published|MIGRATION_DATABASE_URL"
```

Expected, and each of these is a spec requirement rather than a preference:
- `S3_PUBLIC_URL: https://storage.example.test` — not localhost.
- `S3_ENDPOINT: http://storage:9000` — the internal address.
- Published ports only `80`, `443`, `443/udp` and `127.0.0.1` on `5435`.
- `MIGRATION_DATABASE_URL` appears under `sweep` and `migrate`, and **not** under `app`.

- [ ] **Step 9: Commit**

```bash
git add compose.prod.yaml tests/architecture/
git commit -m "feat: production compose stack, under the same architecture guards as the developer one"
```

---

### Task 3: `next.config.ts` allowed origins, and the build arg that feeds it

**Files:**
- Modify: `next.config.ts:73-88`
- Modify: `Dockerfile:41-46` (the `builder` stage)
- Test: `tests/architecture/server-actions-accept-the-production-origin.test.ts` (create)

**Interfaces:**
- Consumes: `APP_DOMAIN` from Task 1, passed as a build arg by Task 2's `app` service.
- Produces: nothing later tasks call. This is the change that decides whether any form on the live site works.

- [ ] **Step 1: Write the failing test**

Create `tests/architecture/server-actions-accept-the-production-origin.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Every form in this application is a Server Action, and Next aborts one whose
 * `Origin` does not match `x-forwarded-host` with "Invalid Server Actions
 * request". `next.config.ts` shipped an `allowedOrigins` of `["localhost:3001",
 * "*.devtunnels.ms"]` with a comment saying, in as many words, "Revisit if a
 * real public deployment, distinct from this local/QA compose stack, is ever
 * stood up."
 *
 * This is that deployment. The failure it prevents is the nastiest shape
 * available: the site renders perfectly, every page loads, and nothing can be
 * submitted — sign-in, registration, lending, returning, every approval queue.
 * Caddy's `reverse_proxy` does set `X-Forwarded-Host`, so the check would most
 * likely pass on its own; "most likely" is not a good enough property for the
 * thing that decides whether a volunteer can lend a book.
 *
 * Asserted as text rather than by importing the config, for the reason
 * `compose-pins-datestyle.test.ts` gives about parsers: `next.config.ts` reads
 * `process.env` at module scope, so importing it here would assert whatever
 * this test process's environment happens to hold rather than what the file
 * says.
 */
const CONFIG = readFileSync("next.config.ts", "utf8");

test("allowedOrigins admits the production domain from the environment", () => {
  expect(CONFIG).toMatch(/allowedOrigins/);
  expect(CONFIG).toMatch(/process\.env\.APP_DOMAIN/);
});

test("the Dockerfile carries APP_DOMAIN into the stage that runs next build", () => {
  // `next.config.ts` is evaluated during `next build`, in the `builder` stage —
  // so a build arg declared only on `runner` would leave `allowedOrigins`
  // without the production domain in the image that actually ships, and the
  // test above would still pass. This is the half that cannot be checked by
  // reading next.config.ts alone.
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const builder = dockerfile.slice(
    dockerfile.indexOf("AS builder"),
    dockerfile.indexOf("AS runner"),
  );

  expect(builder).toMatch(/^ARG APP_DOMAIN$/m);
  expect(builder).toMatch(/^ENV APP_DOMAIN=\$\{APP_DOMAIN\}$/m);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun run test -- tests/architecture/server-actions-accept-the-production-origin.test.ts
```

Expected: FAIL on both — no `process.env.APP_DOMAIN` in `next.config.ts`, no `ARG APP_DOMAIN` in the Dockerfile's builder stage.

- [ ] **Step 3: Update `next.config.ts`**

Replace the `allowedOrigins` line (currently `next.config.ts:88`) with the block below, and append the new paragraph to the comment immediately above it:

```ts
       * **The production domain, from the environment (2026-08-14).** The
       * paragraph above says to revisit this if a real public deployment is
       * stood up; `docs/superpowers/specs/2026-08-14-vps-deployment-design.md`
       * §7.1 is that deployment. `APP_DOMAIN` reaches this file through the
       * `builder` stage's `ARG`/`ENV` pair — `next.config.ts` is evaluated
       * during `next build`, so a value supplied only at runtime arrives after
       * the decision has already been compiled in.
       *
       * Filtered rather than spread unconditionally, because an unset
       * `APP_DOMAIN` would otherwise put `undefined` into the list, and a
       * developer running `bun run dev` has no reason to set it.
       */
      allowedOrigins: [
        "localhost:3001",
        "*.devtunnels.ms",
        ...(process.env.APP_DOMAIN ? [process.env.APP_DOMAIN] : []),
      ],
```

- [ ] **Step 4: Update the Dockerfile's `builder` stage**

In `Dockerfile`, between `WORKDIR /app` and `RUN npm run build` in the `builder` stage, add:

```dockerfile
# `next.config.ts` reads `APP_DOMAIN` to admit the production host into Server
# Actions' `allowedOrigins`, and it is evaluated *here*, during `next build` —
# not at runtime. A value supplied only to the `runner` stage arrives after the
# decision has been compiled into the build, which is a failure with no symptom
# until the first form on the live site is submitted and Next answers "Invalid
# Server Actions request".
#
# Unset for a plain `docker build` and for CI's `--target smoke`, which is
# correct: neither serves the production host, and `next.config.ts` filters an
# empty value out rather than admitting `undefined`.
ARG APP_DOMAIN
ENV APP_DOMAIN=${APP_DOMAIN}

# Caps Node's own heap below the box's real ceiling. On the 2 GB VPS this
# project deploys to, `next build` competing with a running Postgres and MinIO
# is the one command likely to exhaust memory — and the difference this makes
# is between a JavaScript heap-out-of-memory trace naming the phase that failed
# and the kernel's OOM killer removing the process with no message at all.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun run test -- tests/architecture/server-actions-accept-the-production-origin.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Verify nothing else broke**

```bash
bun run typecheck && bun run lint
```

Expected: both clean. `next.config.ts` is typechecked, and the spread is the kind of edit that can produce a `(string | undefined)[]`.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts Dockerfile tests/architecture/server-actions-accept-the-production-origin.test.ts
git commit -m "fix: admit the production domain into Server Actions' allowed origins"
```

---

### Task 4: `Caddyfile`

**Files:**
- Create: `Caddyfile`

**Interfaces:**
- Consumes: `APP_DOMAIN` (Task 1), mounted read-only by Task 2's `caddy` service, which reaches `app:3000` and `storage:9000`.
- Produces: the HTTPS endpoints `deploy.sh` (Task 5) probes.

- [ ] **Step 1: Write the file**

```caddyfile
# OLibra — production reverse proxy and TLS.
#
# Caddy obtains and renews certificates in-process, which is the whole reason
# this file is 30 lines rather than nginx's 130 plus a certbot script: there is
# no ACME challenge webroot to arrange, no `options-ssl-nginx.conf` to fetch
# from a raw GitHub URL, no DH params to generate, and no systemd timer whose
# reload target has to live outside the stack.
#
# `{$APP_DOMAIN}` is Caddy's own environment substitution, filled from the
# variable compose passes the container. Nothing here is hardcoded to a domain.
#
# The certificates and the ACME account key live in the `caddy-data` volume.
# **Do not wipe it casually** — Let's Encrypt allows 5 duplicate certificates
# per registered domain per week, so a needless re-issue can cost a week of no
# TLS.

{
	# Where Let's Encrypt sends expiry warnings. Set to a real address in
	# .env.prod; ACME registration works without it, but nobody is told when
	# renewal has been failing for a fortnight.
	email {$ACME_EMAIL}
}

# ── The application ──────────────────────────────────────────────────────────
{$APP_DOMAIN} {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		# SAMEORIGIN rather than DENY: the QR label sheet is a PDF the browser
		# renders in place, and DENY breaks that preview in some browsers.
		X-Frame-Options "SAMEORIGIN"
	}

	# `reverse_proxy` sets X-Forwarded-Host, X-Forwarded-Proto and
	# X-Forwarded-For by itself. The first of those is what Next compares a
	# Server Action's Origin against — see next.config.ts's allowedOrigins.
	reverse_proxy app:3000

	log {
		output file /var/log/caddy/app.log {
			roll_size 10MiB
			roll_keep 5
		}
	}
}

# ── Object storage ───────────────────────────────────────────────────────────
# Every cover, avatar and condition photograph is an <img> tag pointing here.
# The bucket grants anonymous `s3:GetObject` and nothing else — no listing, no
# writing — which is enforced by compose.prod.yaml's storage-init sidecar and
# asserted by tests/architecture/compose-grants-only-get-object.test.ts.
#
# MinIO's console (:9001) is deliberately absent from this file. It is a login
# form for the root credentials that also hold every child's photograph; reach
# it over an SSH tunnel instead.
storage.{$APP_DOMAIN} {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		# These are images fetched cross-origin by the app's own pages.
		Access-Control-Allow-Origin "https://{$APP_DOMAIN}"
	}

	# 6 MB matches next.config.ts's serverActions.bodySizeLimit, which is itself
	# set above the domain's 5 MB avatar rule (src/lib/avatar-limits.ts) so that
	# a maximum-size photograph is refused by the application's Vietnamese error
	# rather than by a proxy's English one.
	request_body {
		max_size 6MB
	}

	reverse_proxy storage:9000

	log {
		output file /var/log/caddy/storage.log {
			roll_size 10MiB
			roll_keep 5
		}
	}
}
```

- [ ] **Step 2: Add `ACME_EMAIL` to `.env.prod.example`**

The Caddyfile references it. Append to the `# ── Domain ──` section of `.env.prod.example`, comment on its own line:

```bash
# Where Let's Encrypt sends certificate-expiry warnings. Optional — ACME
# registration works without it — but without it nobody is told when renewal
# has been failing.
ACME_EMAIL=
```

- [ ] **Step 3: Validate the Caddyfile syntax**

```bash
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Expected: `Valid configuration`. Warnings about unset `{$APP_DOMAIN}`/`{$ACME_EMAIL}` are expected here and not failures — the variables are supplied by compose at runtime.

- [ ] **Step 4: Confirm the env test still passes**

`.env.prod.example` gained a line; the guard from Task 1 must still be green.

```bash
bun run test -- tests/architecture/env-example-has-no-inline-comments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Caddyfile .env.prod.example
git commit -m "feat: Caddy config for the app and storage hostnames, TLS renewed in-process"
```

---

### Task 5: `deploy.sh`

**Files:**
- Create: `deploy.sh` (mode 755)

**Interfaces:**
- Consumes: `compose.prod.yaml` (Task 2), `.env.prod` derived from Task 1's template, `scripts/ops/backup.sh` (Task 6 — `deploy.sh` calls it if present and warns if not, so the two tasks are independently landable).
- Produces: the operator entry point `docs/DEPLOYMENT.md` (Task 8) documents.

- [ ] **Step 1: Write the script**

Full content in **Appendix B**. Copy it verbatim.

- [ ] **Step 2: Make it executable and syntax-check it**

```bash
chmod +x deploy.sh && bash -n deploy.sh && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 3: Verify `--help` works without an env file**

```bash
./deploy.sh --help
```

Expected: the usage block prints and exits 0. It must not require `.env.prod` — a help flag that fails preflight is useless on a fresh box.

- [ ] **Step 4: Verify the preflight refuses a missing env file**

```bash
./deploy.sh --no-pull; echo "exit=$?"
```

Expected: `[ERROR] .env.prod not found. Copy .env.prod.example and fill it in.` and `exit=1`. Nothing is built, pulled or started.

- [ ] **Step 5: Verify the preflight refuses a placeholder domain**

```bash
cp .env.prod.example .env.prod
./deploy.sh --no-pull; echo "exit=$?"
rm .env.prod
```

Expected: exit 1 naming `APP_DOMAIN`. This confirms the guard fires before any Docker command runs — check the output contains no `docker compose` activity.

- [ ] **Step 6: Verify an unknown flag is rejected**

```bash
./deploy.sh --wat; echo "exit=$?"
```

Expected: `[ERROR] Unknown option: --wat`, exit 1.

- [ ] **Step 7: Commit**

```bash
git add deploy.sh
git commit -m "feat: deploy script — preflight, backup, build, migrate, verify"
```

---

### Task 6: `scripts/ops/backup.sh` and `restore.sh`

**Files:**
- Create: `scripts/ops/backup.sh` (mode 755)
- Create: `scripts/ops/restore.sh` (mode 755)

**Interfaces:**
- Consumes: `compose.prod.yaml`, `.env.prod`.
- Produces: `backups/db/olibra-<UTC timestamp>.dump` (custom format, `pg_restore`-readable) and `backups/storage/`. `deploy.sh` step 3 calls `scripts/ops/backup.sh`; `docs/DEPLOYMENT.md` documents both.

- [ ] **Step 1: Write `scripts/ops/backup.sh`**

Full content in **Appendix C**.

- [ ] **Step 2: Write `scripts/ops/restore.sh`**

Full content in **Appendix D**.

- [ ] **Step 3: Make both executable and syntax-check**

```bash
chmod +x scripts/ops/backup.sh scripts/ops/restore.sh
bash -n scripts/ops/backup.sh && bash -n scripts/ops/restore.sh && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 4: Verify restore refuses without the destroy flag**

This is the guard that matters most in the file — a restore is the one operation that deletes the parish's current records.

```bash
./scripts/ops/restore.sh /tmp/nonexistent.dump; echo "exit=$?"
```

Expected: exit 1 with a message naming `--yes-destroy-current-data`. It must fail on the missing flag **before** it complains about the missing file, so that the flag can never be learned by trial with a real dump in hand.

- [ ] **Step 5: Verify restore refuses a missing dump even with the flag**

```bash
./scripts/ops/restore.sh --yes-destroy-current-data /tmp/nonexistent.dump; echo "exit=$?"
```

Expected: exit 1 naming the missing file.

- [ ] **Step 6: Add `backups/` to `.gitignore`**

```bash
grep -q "^backups/" .gitignore || printf '\n# Database dumps and mirrored objects. Never committed — these hold every\n# personal field in the system.\nbackups/\n' >> .gitignore
```

- [ ] **Step 7: Commit**

```bash
git add scripts/ops/backup.sh scripts/ops/restore.sh .gitignore
git commit -m "feat: backup and restore scripts — pg_dump, not a copy of a live data directory"
```

---

### Task 7: `scripts/ops/bootstrap-vps.sh`

**Files:**
- Create: `scripts/ops/bootstrap-vps.sh` (mode 755)

**Interfaces:**
- Consumes: nothing from the repository — it runs on a bare Ubuntu host, as root, before the repository is even cloned.
- Produces: the `deploy` user, Docker, the 2 GB swapfile `deploy.sh`'s preflight requires, ufw rules, and the nightly cron entry calling Task 6's `backup.sh`.

- [ ] **Step 1: Write the script**

Full content in **Appendix E**.

- [ ] **Step 2: Make it executable and syntax-check**

```bash
chmod +x scripts/ops/bootstrap-vps.sh && bash -n scripts/ops/bootstrap-vps.sh && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 3: Verify the dry-run path prints without changing anything**

```bash
./scripts/ops/bootstrap-vps.sh; echo "exit=$?"
```

Expected: the plan of changes prints, followed by a refusal to proceed without `--yes`, exit 1. **Do not run it with `--yes` on your development machine** — it installs Docker, edits `/etc/fstab` and enables a firewall.

- [ ] **Step 4: Verify it refuses to run as non-root**

The script edits `/etc/fstab` and ufw. Run it without `sudo`:

```bash
./scripts/ops/bootstrap-vps.sh --yes; echo "exit=$?"
```

Expected: exit 1 with "must be run as root", **before** any change is attempted.

- [ ] **Step 5: Commit**

```bash
git add scripts/ops/bootstrap-vps.sh
git commit -m "feat: one-time VPS host bootstrap — user, docker, swap, firewall, backup cron"
```

---

### Task 8: `docs/DEPLOYMENT.md` and the README status row

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Modify: `README.md` (the status table's `Hosting` row and the documentation table)

**Interfaces:**
- Consumes: every file from Tasks 1–7.
- Produces: the runbook. Nothing consumes it but a person.

- [ ] **Step 1: Write `docs/DEPLOYMENT.md`**

Full content in **Appendix F**. It must contain, at minimum: first-deploy walkthrough from a bare VPS, DNS records required, secret generation commands, the routine deploy command, the rollback procedure, the restore walkthrough, and how to reach MinIO's console over SSH.

- [ ] **Step 2: Update the README status table**

Change the `Hosting` row from `| Hosting | **Open** |` to:

```markdown
| Hosting | **Settled** — a single VPS, Caddy in front, `./deploy.sh`. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) |
```

- [ ] **Step 3: Add DEPLOYMENT.md to the README documentation table**

After the `OPERATIONS.md` row:

```markdown
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Standing the system up on a VPS: first deploy, routine deploys, backups, restores, rollback. |
```

- [ ] **Step 4: Verify the documentation links resolve**

The repository has a link checker for exactly this.

```bash
bun run check:links
```

Expected: PASS. A broken relative link in a new document is the most common defect this catches.

- [ ] **Step 5: Run the full check suite**

```bash
bun run check
```

Expected: typecheck, lint, format and the whole test suite all green. This is the gate before the branch is proposed for merge.

- [ ] **Step 6: Commit**

```bash
git add docs/DEPLOYMENT.md README.md
git commit -m "docs: deployment runbook, and README's Hosting row is no longer Open"
```

---

## Appendix A — `compose.prod.yaml`

```yaml
# OLibra — production stack for a single VPS.
#
#   ./deploy.sh
#
# Not a profile on compose.yaml, and deliberately so: a profile cannot change a
# port mapping, so `db`'s bindings would have to be right for a developer's
# machine and a public one simultaneously. The failure mode of getting that
# wrong is a Postgres superuser reachable from the internet.
#
# Only `caddy` publishes ports. Everything else talks over this file's default
# network by service name, which is the only address any of it needs.

name: olibra-prod

volumes:
  # Issued certificates and the ACME account key. Wiping this is not a free
  # re-issue: Let's Encrypt allows 5 duplicate certificates per registered
  # domain per week.
  caddy-data:
  caddy-config:
  caddy-logs:

services:
  # ── Reverse proxy and TLS ──────────────────────────────────────────────────
  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    mem_limit: 128m
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      APP_DOMAIN: ${APP_DOMAIN:?set APP_DOMAIN in .env.prod}
      ACME_EMAIL: ${ACME_EMAIL:-}
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
      - caddy-logs:/var/log/caddy
    depends_on:
      # `service_started`, not `service_healthy`. Caddy must come up even when
      # the application is broken: a 502 is a more honest answer than a
      # connection refused, and — more importantly — ACME renewal must keep
      # working while the app is down, or a long outage becomes an expired
      # certificate on top of an outage.
      app:
        condition: service_started

  # ── PostgreSQL ─────────────────────────────────────────────────────────────
  db:
    image: postgres:16.10-alpine
    restart: unless-stopped
    mem_limit: 512m
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-olibra}
      POSTGRES_USER: ${POSTGRES_USER:-olibra}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env.prod}
      POSTGRES_INITDB_ARGS: "--locale=C.UTF-8 --encoding=UTF8"
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    # The same pin compose.yaml carries, for the same reason and with a sharper
    # edge in production: the image default is `ISO, MDY`, under which
    # `02/04/2015` — 2 April 2015, as it is written in Vietnamese — is stored as
    # `2015-02-03`. A child's date of birth, wrong, with nothing raised.
    command: ["postgres", "-c", "datestyle=ISO, YMD"]
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    ports:
      # Loopback, written in full. `5435:5432` binds 0.0.0.0 and is the exact
      # mistake this line exists not to make. Reachable over an SSH tunnel for
      # psql, and from nowhere else.
      - "127.0.0.1:${POSTGRES_PORT:-5435}:5432"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "pg_isready -U ${POSTGRES_USER:-olibra} -d ${POSTGRES_DB:-olibra}",
        ]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  # ── Object storage ─────────────────────────────────────────────────────────
  storage:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    restart: unless-stopped
    mem_limit: 512m
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID in .env.prod}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY in .env.prod}
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    volumes:
      - ./data/minio:/data
    # No published ports at all — not even the console on 9001. The console is
    # a login form for the root credentials above, which also hold every child's
    # photograph. Reach it over an SSH tunnel; see docs/DEPLOYMENT.md.
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 15s

  # Creates the bucket once and exits. Idempotent, so a restart is harmless.
  storage-init:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    depends_on:
      storage:
        condition: service_healthy
    # Byte-identical to compose.yaml's, and required to stay so by
    # tests/architecture/compose-grants-only-get-object.test.ts, which reads the
    # document out of both files and compares each against
    # tests/support/bucket-policy.ts.
    #
    # `anonymous set-json` with the document written out in full, never the
    # shorthand `mc anonymous set download`: `download` is not read-only. It
    # also grants `s3:ListBucket`, and an unauthenticated
    # `GET /<bucket>/?list-type=2` then paginates the key of every avatar, cover
    # and condition photograph — and the avatars are photographs of children.
    # Opaque UUID keys protect nothing once the keys can be enumerated.
    entrypoint:
      - /bin/sh
      - -c
      - |
        set -e
        mc alias set olibra http://storage:9000 '${S3_ACCESS_KEY_ID}' '${S3_SECRET_ACCESS_KEY}'
        mc mb --ignore-existing olibra/${S3_BUCKET:-olibra}
        printf %s '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::${S3_BUCKET:-olibra}/*"]}]}' > /tmp/public-read.json
        mc anonymous set-json /tmp/public-read.json olibra/${S3_BUCKET:-olibra}
        echo 'bucket ready: ${S3_BUCKET:-olibra}'
    # NOT `unless-stopped`. This container's job is to exit 0, and
    # `unless-stopped` restarts a clean exit as readily as a crash — the sidecar
    # would spin forever re-applying a policy nobody changed.
    restart: "no"

  # ── Application ────────────────────────────────────────────────────────────
  app:
    build:
      context: .
      dockerfile: Dockerfile
      # Not the implicit last stage — that is `smoke`, whose RUN step boots the
      # server with none of the environment a real boot has. compose.yaml
      # carries the same line with the fuller explanation.
      target: runner
      args:
        # Reaches next.config.ts during `next build`, where allowedOrigins is
        # decided. See the Dockerfile's builder stage.
        APP_DOMAIN: ${APP_DOMAIN}
        # The 2 GB box. See the Dockerfile's builder stage.
        NODE_OPTIONS: --max-old-space-size=1536
    image: olibra-app:prod
    restart: unless-stopped
    mem_limit: 700m
    depends_on:
      db:
        condition: service_healthy
      storage:
        condition: service_healthy
    environment:
      # olibra_pool, never the superuser. A superuser connection bypasses row
      # level security unconditionally (DATABASE.md §3), which would make every
      # RLS policy in this project inert on the one connection that serves
      # public requests.
      DATABASE_URL: postgres://olibra_pool:${OLIBRA_POOL_PASSWORD:?set OLIBRA_POOL_PASSWORD in .env.prod}@db:5432/${POSTGRES_DB:-olibra}
      #
      # MIGRATION_DATABASE_URL is deliberately ABSENT here, unlike compose.yaml.
      # It names the olibra superuser — able to create roles and disable RLS —
      # and the process serving anonymous HTTP requests has no business holding
      # it. The `migrate` service below carries it instead.
      #
      # Safe to omit: of the four modules that read it, only
      # src/instrumentation.ts runs in the server, and its
      # checkDatabaseUrlsForSwallowedComments guards it with `if (!value)
      # continue`.
      #
      # The server reaches MinIO over this file's network; a browser does not.
      S3_ENDPOINT: http://storage:9000
      S3_REGION: ${S3_REGION:-us-east-1}
      S3_BUCKET: ${S3_BUCKET:-olibra}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-true}
      # What ObjectStore.url() builds the URL a *browser* fetches from. Derived
      # here rather than set in .env.prod, because the one thing this value must
      # never say is `localhost` — which is what it says by default, and which
      # renders every cover and avatar on the live site broken while the server
      # logs nothing at all.
      S3_PUBLIC_URL: https://storage.${APP_DOMAIN}
      # Read by next.config.ts at runtime too, harmlessly; the value that
      # matters was compiled in at build time from the build arg above.
      APP_DOMAIN: ${APP_DOMAIN}
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    healthcheck:
      # `bun -e`, not curl or wget. oven/bun's image is not guaranteed to carry
      # either, and a healthcheck whose binary is missing reports `unhealthy`
      # forever — a failure that looks exactly like the application being
      # broken, which is the worst possible disguise for it to wear.
      #
      # The Dockerfile's runner stage says "No HEALTHCHECK here — compose owns
      # it". This is compose owning it; compose.yaml never defined the other
      # half.
      test:
        [
          "CMD",
          "bun",
          "-e",
          "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # ── Reminder sweep ─────────────────────────────────────────────────────────
  # BR §15's "nhắc trả sách" reminders, three days before a loan falls due and
  # again once it lapses. Same image as `app`, a shell loop rather than cron,
  # once a day at 07:00 — compose.yaml carries the full reasoning for all three
  # decisions and it is unchanged here.
  sweep:
    image: olibra-app:prod
    restart: unless-stopped
    mem_limit: 128m
    depends_on:
      db:
        condition: service_healthy
    environment:
      # Not DATABASE_URL. The sweep's first statement is `set local role
      # olibra_admin` because it spans every shelf, and olibra_pool is
      # deliberately not a member of olibra_admin — under it, that statement is
      # `42501: permission denied to set role`.
      MIGRATION_DATABASE_URL: postgres://${POSTGRES_USER:-olibra}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-olibra}
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    # `$` is doubled throughout because this text goes through two substitution
    # passes: compose interpolates `${VAR}` in every string in this file first,
    # and only what survives reaches the container's shell. A single `$` here is
    # "compose will try to resolve this", and `$today`/`$now`/`$last_run` are
    # not compose variables — the first draft of this in compose.yaml silently
    # ran with all three replaced by empty strings.
    command:
      - /bin/sh
      - -c
      - |
        set -e
        echo "sweep: scheduler started — runs \`bun run db:sweep\` once a day at 07:00 $$TZ"
        last_run=""
        while true; do
          today=$$(date +%F)
          now=$$(date +%H:%M)
          if [ "$$now" = "07:00" ] && [ "$$last_run" != "$$today" ]; then
            echo "sweep: 07:00 $$TZ reached — running for $$today"
            if bun run db:sweep; then
              echo "sweep: $$today run finished"
            else
              echo "sweep: $$today run FAILED (exit $$?) — will try again at 07:00 tomorrow"
            fi
            last_run="$$today"
          fi
          sleep 20
        done

  # ── Migrations ─────────────────────────────────────────────────────────────
  # A one-off, run by deploy.sh between the build and the restart:
  #
  #   docker compose -f compose.prod.yaml --env-file .env.prod run --rm migrate
  #
  # Its own service rather than `run --rm app` precisely so that `app` above can
  # drop MIGRATION_DATABASE_URL — a `run` against `app` would inherit `app`'s
  # environment, which is the environment the superuser was removed from.
  #
  # Behind a profile so an ordinary `up -d` never starts it, and `restart: "no"`
  # for the same reason storage-init has it: this container's job is to exit.
  migrate:
    build:
      context: .
      dockerfile: Dockerfile
      target: runner
      args:
        APP_DOMAIN: ${APP_DOMAIN}
        NODE_OPTIONS: --max-old-space-size=1536
    image: olibra-app:prod
    profiles: ["tools"]
    restart: "no"
    depends_on:
      db:
        condition: service_healthy
    environment:
      # The olibra superuser, deliberately: creating roles, enabling row level
      # security, and 0010_rls.sql's own `create role` statements all need
      # privileges olibra_pool must never have.
      MIGRATION_DATABASE_URL: postgres://${POSTGRES_USER:-olibra}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-olibra}
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
    command: ["bun", "run", "db:migrate"]
```

## Appendix B — `deploy.sh`

See the implemented file. Its structure, in order:

1. **Header comment** — usage, every flag, three worked examples. `--help` prints it.
2. **`set -euo pipefail`**, then `COMPOSE_FILE`/`ENV_FILE`/`COMPOSE=(...)` as an array.
3. **Colour helpers** — `info`/`success`/`warn`/`error`, `error` exiting 1.
4. **Argument parsing** — `--domain`, `--no-pull`, `--no-build`, `--no-backup`, `--service`, `--migrate-only`, `-h|--help`; unknown flags are an error.
5. **`get_env_value`/`set_env_value`** — read and write a key in `.env.prod` without sourcing it.
6. **`preflight`** — the eight checks from spec §4.1, each naming its fix.
7. **`wait_healthy <service> <attempts>`** — polls `docker inspect`, printing each attempt.
8. **`probe_https`** — `curl -fsS https://$APP_DOMAIN/` and grep for `OLibra`.
9. **`main`** — the nine-step sequence from spec §4.3.

## Appendix C — `scripts/ops/backup.sh`

See the implemented file. In order: resolve the repo root; `mkdir -p backups/db backups/storage`; `pg_dump -Fc` through `docker compose exec -T db`; `chmod 600` the dump; `mc mirror --overwrite` the bucket via a throwaway `minio/mc` container on the stack's network; prune to the newest 14 dumps; print the sizes.

## Appendix D — `scripts/ops/restore.sh`

See the implemented file. In order: require `--yes-destroy-current-data` **before** any other validation; require the dump file to exist; take a safety backup of the current database first; `docker compose stop app sweep`; `pg_restore --clean --if-exists` through `docker compose exec -T db`; restart `app` and `sweep`; print what to verify by hand.

## Appendix E — `scripts/ops/bootstrap-vps.sh`

See the implemented file. In order: refuse non-root; print the plan and require `--yes`; create the `deploy` user in the `docker` group; install Docker Engine + compose plugin from Docker's apt repository; create and persist a 2 GB swapfile with `vm.swappiness=10`; write `/etc/docker/daemon.json` with `log-opts` so container logs cannot fill the disk; install and configure `fail2ban` and `unattended-upgrades`; `timedatectl set-timezone Asia/Ho_Chi_Minh`; install the nightly backup cron entry; configure and enable `ufw` **last**, printing the SSH-lockout warning before it does.

## Appendix F — `docs/DEPLOYMENT.md`

See the implemented file. Sections: what you need before starting (VPS, domain, two DNS A records); first deploy, step by step from a bare host; generating the secrets; routine deploys; what a deploy does and how long it is down; reading logs; backups and the restore walkthrough; rolling back; reaching MinIO's console over SSH; and a troubleshooting table covering the failures this design predicts — a build killed by the OOM killer, a certificate that will not issue, broken images, and "Invalid Server Actions request".
