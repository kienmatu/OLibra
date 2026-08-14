import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Traces the server build down to the files it actually uses, so the runtime
   * image carries no node_modules. Without this the image is roughly an order
   * of magnitude larger for no benefit — nothing in a container needs the
   * dependency tree once the build is done.
   */
  output: "standalone",

  /**
   * The vendored Lexend faces, forced into the standalone build.
   *
   * `src/lib/qr-labels.ts` reads two `.ttf` files from disk at request time to
   * draw the QR label sheet — it has to, because pdf-lib's built-in fonts
   * cannot render Vietnamese and `next/font` emits woff2, which fontkit does
   * not read. Next's tracer follows `import`s; it cannot see a path assembled
   * for `readFileSync`, so without this entry the files are simply absent from
   * the image.
   *
   * The failure that causes is the nastiest kind: the route works perfectly
   * under `bun run dev`, where the whole repository is on disk, and throws
   * ENOENT the first time a volunteer presses "In mã QR" in production. No
   * test on a developer's machine can catch it, which is why it is written
   * down here rather than left to be rediscovered.
   */
  outputFileTracingIncludes: {
    "/tu-sach/[shelf]/quan-ly/xuat/ma-qr": ["./src/lib/fonts/*.ttf"],
  },

  experimental: {
    serverActions: {
      /**
       * The framework's backstop, deliberately **above** the domain's own limit
       * rather than beneath it.
       *
       * Next's default is 1 MB — `defaultBodySizeLimit` in
       * `next/dist/server/app-render/action-handler.js`, applied to every server
       * action's request body before a byte of application code runs. This
       * project's avatar rule is 5 MB (`AVATAR_MAX_BYTES` in
       * `src/lib/avatar-limits.ts`, which OPS §4.3's `file_too_large` states in
       * Vietnamese: "Ảnh vượt quá 5 MB."). With the default in force those two
       * numbers disagreed over the whole 1–5 MB band, and the framework won.
       *
       * Measured over real HTTP against `bun run dev`, before this setting
       * existed: a 1.6 MB multipart POST to the profile page's avatar form
       * returned a 500 whose body was `Body exceeded 1 MB limit.` (`E394`) in
       * about 7 ms — no Vietnamese, no `?loi=`, and the action never invoked. A
       * volunteer who photographs a child on a phone produces a 1.4 MB JPEG
       * routinely; they would have been told nothing at all, by a screen that
       * says the limit is 2 MB.
       *
       * It is a backstop and not the rule. The rule stays in `src/lib/avatar.ts`,
       * where it can raise `file_too_large`; this only stops a body so large
       * that buffering it is itself the attack.
       * `tests/lib/avatar-over-http.test.ts` posts across the band and asserts
       * which of the two decided — one of two tests in the suite that go
       * through Next's own handler rather than calling the action function
       * (`tests/lib/registration-over-http.test.ts` is the other, sharing the
       * same harness, `tests/support/http.ts`).
       *
       * Strictly above `AVATAR_MAX_BYTES` (5 MB, `src/lib/avatar-limits.ts`) and
       * not equal to it: a multipart body is larger than the file inside it, so a
       * limit set *at* the application's own number refuses a maximum-size
       * photograph before any application code runs — and the reader gets a
       * framework error instead of "Ảnh vượt quá 5 MB."
       */
      bodySizeLimit: "6mb",

      /**
       * Dev tunnels (VS Code / `devtunnels.ms`) proxy the app under a
       * `*.devtunnels.ms` hostname. Server Actions compare the request's
       * `Origin` against `x-forwarded-host`/`Host` and abort with "Invalid
       * Server Actions request" on a mismatch — this widens that allowlist
       * to cover it.
       *
       * Not gated on `NODE_ENV`: `compose.yaml`'s `app` service — the only
       * environment this project runs in today, per its own "every developer
       * runs this" comment — builds from the `runner` stage, which hardcodes
       * `NODE_ENV=production` (Dockerfile). A dev-only gate here would silently
       * no-op in that container, which is exactly the bug this replaces.
       * Revisit if a real public deployment, distinct from this local/QA
       * compose stack, is ever stood up.
       */
      allowedOrigins: ["localhost:3001", "*.devtunnels.ms"],
    },
  },

  /**
   * The reader area moved from `toi` to `ho-so` (Task 7, 2026-08-10 QA
   * remediation) — `toi` reads as a pronoun and does not say what the area
   * holds. Permanent, because these are URLs a child bookmarked on a phone;
   * `permanent: true` sends a 308 that browsers cache indefinitely, matching
   * the reasoning `src/app/tu-sach/[shelf]/tang-sach/page.tsx` gives for why
   * *its* redirect deliberately does not.
   *
   * **Order is load-bearing.** Next matches top to bottom and stops at the
   * first hit. `/toi/ho-so` (the profile, which became the area's own index)
   * must be listed before the `/toi/:rest*` catch-all, or it would match the
   * wildcard first and land on `/ho-so/ho-so` — a route that does not exist —
   * instead of `/ho-so`. `tests/architecture/the-toi-ho-so-redirect-order.test.ts`
   * pins this so it cannot regress silently.
   */
  async redirects() {
    return [
      {
        source: "/tu-sach/:shelf/toi",
        destination: "/tu-sach/:shelf/ho-so/tong-quan",
        permanent: true,
      },
      {
        source: "/tu-sach/:shelf/toi/ho-so",
        destination: "/tu-sach/:shelf/ho-so",
        permanent: true,
      },
      {
        source: "/tu-sach/:shelf/toi/:rest*",
        destination: "/tu-sach/:shelf/ho-so/:rest*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
