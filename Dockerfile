# Bun installs, Node compiles, Bun runs.
#
# The runtime is Bun by preference: the lockfile, the local scripts and the
# production process then agree, which removes a class of "works locally, not
# in the image".
#
# The build stage is the one exception, and it is a workaround rather than a
# preference. `bun run build` segfaults partway through `next build` inside a
# linux/arm64 container — verified on Bun 1.3.5 and 1.3.14, on both alpine
# (musl) and Debian (glibc), so it is neither a libc problem nor a stale
# version. The same command succeeds under Bun on macOS, which is why local
# development never sees it. Node is what Next.js is tested against anyway, so
# compiling there costs nothing and removes the crash.
#
# The remaining tradeoff is honest: Next.js does not test against Bun, so a
# Next upgrade is the likeliest thing to break the runtime. The `smoke` stage
# is the guard — it boots the built server under Bun and fails the build if it
# does not serve the landing page.
ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=22


# ── dependencies ─────────────────────────────────────────────────────────────
# Bun owns the install because bun.lock is the lockfile. Copied on their own so
# a change to application source does not invalidate the install layer.
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
# Puppeteer is a devDependency used only by the local documentation scripts
# (mermaid validation, PDF export). Its postinstall downloads a whole Chrome,
# which the image neither needs nor can extract — there is no unzip here. The
# build does need the other devDependencies (TypeScript, Tailwind), so skipping
# the browser download is the precise fix rather than skipping dev deps.
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile


# ── build ────────────────────────────────────────────────────────────────────
# Node, for the reason given at the top of this file. `bun install` produces an
# ordinary node_modules tree, so it carries across unchanged.
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# `next.config.ts` reads APP_DOMAIN to admit the production host into Server
# Actions' `allowedOrigins`, and it is evaluated *here*, while `next build`
# runs — not at runtime in the `runner` stage below.
#
# That distinction is the whole reason this line exists rather than a runtime
# environment variable. A value supplied only to the running container arrives
# after the decision has been compiled into the build, and the resulting failure
# has no symptom at all until the first form on the live site is submitted and
# Next answers "Invalid Server Actions request" — a site that renders perfectly
# and cannot be used.
#
# Deliberately unset for a plain `docker build` and for CI's
# `--target smoke`: neither serves the production host, and `next.config.ts`
# filters an empty value out rather than admitting `undefined` into the list.
ARG APP_DOMAIN
ENV APP_DOMAIN=${APP_DOMAIN}

# Caps Node's own heap below the host's real ceiling.
#
# On the 2 GB VPS this project deploys to, `next build` peaks near 2 GB while a
# running Postgres and MinIO already hold ~400 MB, so this is the one command in
# a deploy likely to exhaust memory. What the cap buys is not survival — it is a
# JavaScript heap-out-of-memory trace naming the phase that failed, instead of
# the kernel's OOM killer removing the process and leaving a bare `Killed`.
#
# Scoped to this stage on purpose. The runtime is Bun, not Node, so an inherited
# NODE_OPTIONS there would be at best ignored and at worst a warning on every
# boot, carrying a heap ceiling that describes a build machine.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

RUN npm run build


# ── runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run as root. The uid is fixed so a bind-mounted volume can be chowned
# to something predictable on the host. The base image ships its own `bun` user
# at uid 1000; ours is separate and deliberate.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# ── CLI scripts (db:migrate, db:seed, db:sweep) ─────────────────────────────
# None of the three is reachable from `src/app`, so `output: "standalone"`'s
# trace carries no sign of them: `next build` bundles every server-reachable
# module into `.next/server`'s webpack chunks and keeps no raw `src/*.ts` file
# around to run directly, and the traced `node_modules` two lines down keeps
# only the packages that had to stay external to that bundle (native bindings —
# `sharp`, `@node-rs/argon2`). `postgres`, the pure-JS package all three
# scripts need, is not one of them. Verified rather than assumed while wiring
# QA remediation Task 24's `sweep` service: `docker exec <app-container> bun
# run db:migrate` against the image built without the two lines below fails
# before it ever opens a connection —
#
#   error: Module not found "src/db/migrate-cli.ts"
#
# — which means `docker compose exec app bun run db:migrate`, the very usage
# this file's own comment on `app`'s `MIGRATION_DATABASE_URL` describes below,
# had never actually worked against a built image, only against `bun run dev`.
#
# **Copy only what's actually missing, not the whole untraced tree.** A first
# pass here copied the entire `builder`-stage `node_modules` — the `deps`
# stage's `bun install --frozen-lockfile` has no `--production`, so that tree
# carries all fifteen devDependencies (mermaid 83 MB, eslint-config-next
# 110 MB, typescript + @types ~49 MB, pdf-lib, puppeteer/chromium-bidi, vitest,
# prettier…) which no CLI script imports, ever — `grep -n "^import"` across
# `migrate-cli.ts`, `seed-cli.ts`, `sweep-cli.ts` and everything they in turn
# import (`./client`, `./migrate`, `./seed`, `../domain/kernel/clock`,
# `../domain/notifications/sweep`, `../auth/password`, `../lib/fixtures`) names
# exactly one npm package the traced `node_modules` below doesn't already
# carry: `postgres` — a pure-JS package with **zero** dependencies of its own
# (`node_modules/postgres/package.json` has no `dependencies` key at all),
# 380 KB on disk. `@node-rs/argon2`, which `seed.ts` needs for `hashPassword`,
# is already present below — it's a native binding the running server itself
# uses for sign-in, so it was never missing. That first pass took the runtime
# image from ~300 MB to ~1.1 GB to add back 380 KB of genuine need; caught in
# review, and worth recording so nobody repeats it: verify what a script
# actually imports before copying the tree it might import from.
#
# So: this one package, copied by name, plus the raw `src` tree so
# `bun run db:sweep` (and `db:migrate`, `db:seed`) run the file directly under
# Bun's native TypeScript support instead of through anything Next built.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/src ./src

COPY --from=builder /app/public ./public
# `output: "standalone"` emits a server plus only the files it traced, so this
# adds the rest of `node_modules` alongside the single package copied above —
# the two do not overlap (`postgres` was never part of the trace, per the note
# above), so nothing here is overwritten, only supplemented.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# No HEALTHCHECK here — compose owns it, so the check and the dependency
# ordering live in one file rather than two.
CMD ["bun", "server.js"]


# ── smoke test ───────────────────────────────────────────────────────────────
# Not part of the runtime image. Built explicitly in CI:
#
#   docker build --target smoke .
#
# Boots the real server under Bun and fails unless it serves the landing page.
# This is what turns "Bun runs Next today" into something verified per build
# rather than assumed, and it is why a Next upgrade cannot quietly ship a
# runtime that starts and then serves nothing. The probe runs under Bun too, so
# nothing extra is installed to perform it.
FROM runner AS smoke
RUN bun server.js & \
    bun -e ' \
      const deadline = Date.now() + 30_000; \
      while (Date.now() < deadline) { \
        try { \
          const res = await fetch("http://127.0.0.1:3000/"); \
          const body = await res.text(); \
          if (res.ok && body.includes("OLibra")) { \
            console.log("smoke: Bun served the landing page"); \
            process.exit(0); \
          } \
          console.log(`smoke: status ${res.status}, retrying`); \
        } catch { /* not listening yet */ } \
        await Bun.sleep(1000); \
      } \
      console.error("smoke: Bun never served the landing page"); \
      process.exit(1); \
    '

# Uploads decode, crop and re-encode through sharp, a native binding. The
# landing page renders without ever loading it, so a linux binary that is
# missing or built for the wrong platform would pass the probe above and fail
# the first reader who tried to change their photograph. This encodes a real
# image under Bun, which is the runtime that actually serves requests.
RUN bun -e ' \
      const sharp = (await import("sharp")).default; \
      const out = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c56b4a" } }) \
        .resize(32, 32, { fit: "cover", position: "centre" }) \
        .webp({ quality: 82 }) \
        .toBuffer(); \
      const meta = await sharp(out).metadata(); \
      if (meta.format !== "webp" || meta.width !== 32) { \
        console.error(`smoke: sharp produced ${meta.format} ${meta.width}px`); \
        process.exit(1); \
      } \
      console.log("smoke: sharp encoded a WebP under Bun"); \
    '
