import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Every form in this application is a Server Action, and Next aborts one whose
 * `Origin` does not match `x-forwarded-host` with "Invalid Server Actions
 * request". `next.config.ts` shipped an `allowedOrigins` of
 * `["localhost:3001", "*.devtunnels.ms"]` under a comment that says, in as many
 * words: *"Revisit if a real public deployment, distinct from this local/QA
 * compose stack, is ever stood up."*
 *
 * `docs/superpowers/specs/2026-08-14-vps-deployment-design.md` is that
 * deployment, and the failure this guards against has the nastiest shape
 * available: the site renders perfectly, every page loads, every image
 * appears — and nothing can be submitted. Not sign-in, not registration, not
 * lending, not returning, not one approval queue. A volunteer standing at the
 * shelf with a book in one hand sees a page that looks entirely correct and a
 * button that does nothing.
 *
 * Caddy's `reverse_proxy` does set `X-Forwarded-Host` by itself, so the origin
 * check would most likely pass without this. "Most likely" is not a good enough
 * property for the thing that decides whether a book can be lent, so the domain
 * is admitted explicitly and this test holds it there.
 *
 * **Asserted as text rather than by importing the config.** `next.config.ts`
 * reads `process.env` at module scope, so importing it here would assert
 * whatever this test process's environment happens to hold rather than what the
 * file says — the same reasoning `compose-pins-datestyle.test.ts` gives for
 * reading YAML as text instead of agreeing with a parser.
 */
test("allowedOrigins admits the production domain from the environment", () => {
  const config = readFileSync("next.config.ts", "utf8");

  expect(config).toMatch(/allowedOrigins/);
  expect(config).toMatch(/process\.env\.APP_DOMAIN/);
});

/**
 * The half that reading `next.config.ts` alone cannot check.
 *
 * `next.config.ts` is evaluated during `next build`, in the `builder` stage —
 * not at runtime, in `runner`. So a build arg declared only on the runtime
 * stage would leave `allowedOrigins` without the production domain in the image
 * that actually ships, while the test above went on passing. The two halves
 * fail independently and are therefore asserted independently.
 */
test("the Dockerfile carries APP_DOMAIN into the stage that runs next build", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const builder = dockerfile.slice(
    dockerfile.indexOf("AS builder"),
    dockerfile.indexOf("AS runner"),
  );

  expect(builder).toMatch(/^ARG APP_DOMAIN$/m);
  expect(builder).toMatch(/^ENV APP_DOMAIN=\$\{APP_DOMAIN\}$/m);
});

/**
 * `NODE_OPTIONS` belongs to the builder and must not leak into the runtime.
 *
 * The 2 GB VPS needs `--max-old-space-size=1536` while `next build` runs, and
 * the runtime is Bun, which is not Node — an inherited `NODE_OPTIONS` there is
 * at best ignored and at worst a warning on every boot, for a heap ceiling that
 * describes a build machine rather than a serving process.
 */
test("NODE_OPTIONS is scoped to the builder stage and does not reach the runner", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const builderStart = dockerfile.indexOf("AS builder");
  const runnerStart = dockerfile.indexOf("AS runner");

  const builder = dockerfile.slice(builderStart, runnerStart);
  const afterBuilder = dockerfile.slice(runnerStart);

  expect(builder).toMatch(/^ARG NODE_OPTIONS$/m);
  expect(afterBuilder).not.toMatch(/NODE_OPTIONS/);
});
