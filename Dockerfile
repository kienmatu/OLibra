# Node, not Bun. Bun is the local developer's package manager and script
# runner (AGENTS.md); the image runs what production runs.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app


# ── dependencies ─────────────────────────────────────────────────────────────
# Copied on their own so a change to application source does not invalidate the
# install layer. bun.lock is the lockfile, so bun does the install here even
# though Node runs the result.
FROM base AS deps
COPY package.json bun.lock ./
RUN npm install -g bun@1.3.5 \
 && bun install --frozen-lockfile


# ── build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g bun@1.3.5 && bun run build


# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run as root. The uid is fixed so a bind-mounted volume can be chowned
# to something predictable on the host.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# `output: "standalone"` emits a server plus only the files it traced, so no
# node_modules is copied here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# No HEALTHCHECK here — compose owns it, so the check and the dependency
# ordering live in one file rather than two.
CMD ["node", "server.js"]
