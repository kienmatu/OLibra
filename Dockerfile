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

COPY --from=builder /app/public ./public
# `output: "standalone"` emits a server plus only the files it traced, so no
# node_modules is copied here.
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
