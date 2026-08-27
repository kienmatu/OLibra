import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { testDatabaseUrl, testPoolDatabaseUrl } from "./env";

/**
 * A real `next dev` server, for the handful of tests that must prove
 * something only a genuine HTTP request can prove.
 *
 * Extracted from `tests/lib/avatar-over-http.test.ts`, the first test file
 * that needed this shape — its own docstring explains why calling a server
 * action as a plain function is not enough there: Next applies request-level
 * behaviour (a body-size limit, in that file's case) before the action is
 * ever invoked, and none of that runs when a test imports the action
 * function and calls it directly.
 *
 * `tests/lib/registration-over-http.test.ts` needed the identical
 * bring-up-and-tear-down sequence for the equivalent reason, one Turbopack
 * layer over: `src/domain/kernel/crypto.ts`'s docstring records that Next
 * bundles a module imported by both `src/instrumentation.ts` (the `node`
 * layer) and a server action (the `react-server` layer) as two separate
 * instances, so wiring performed in one is invisible to the other — a defect
 * that is, by construction, invisible to a test that imports the action and
 * calls it in-process, because doing so never crosses the layer boundary at
 * all. Only a request through Next's own handler does. A second ~130-line
 * copy of this file's spawn/wait/teardown sequence would have let the two
 * test files' idea of "the server is ready" drift apart unnoticed; this is
 * the one copy both share.
 */
export interface TestServer {
  /** `http://127.0.0.1:<port>` — build a URL onto this the way `fetch` needs. */
  readonly origin: string;
  /** Kills the child process and restores `tsconfig.json` if the dev server rewrote it. */
  close(): Promise<void>;
}

/**
 * `tsconfig.json`, as it stands before the dev server touches it.
 *
 * Next rewrites that file the first time it type-checks a page — it appends
 * its own generated `types` globs and reserialises the whole document with
 * its own JSON formatting, which is not Prettier's. That is normal for a
 * developer running `bun run dev`, and it is intolerable inside `bun run
 * check`, where the next step is `format:check` on a file the test just
 * reformatted. Restored verbatim in `close()` rather than left to a
 * `.gitignore` or a lint exemption, because the honest statement is that
 * starting a dev server has a side effect on the working tree, and this
 * undoes it.
 */
const TSCONFIG = "tsconfig.json";

/**
 * Everything a spawned server said, capped.
 *
 * **Spawning with `stdio: "ignore"` cost a previous version of this harness
 * an afternoon.** Next refuses to start a second dev server for the same
 * project directory even on a different port —
 *
 * ```
 * ⨯ Another next dev server is already running.
 * - Local:        http://localhost:3000
 * - PID:          28918
 * ```
 *
 * — and with the child's output discarded, that sentence went nowhere. The
 * failure surfaced as "the dev server never came up", which is true, is
 * useless, and points at the port rather than at the reason. The child's own
 * words are the diagnosis, so they are kept and put in the thrown error.
 *
 * Capped because a server that *does* come up logs every compile for the
 * rest of the run into a string nobody reads; the tail is what matters.
 */
const MAX_OUTPUT = 8_000;

/**
 * Spawns `next dev` on `port`, waits for it to answer, and returns a handle
 * to talk to and then tear it down.
 *
 * Spawned from `../node_modules/.bin/next` — `node_modules` is hoisted to the
 * repo root, shared with the Laravel app (see AGENTS.md) — rather than
 * through `bun run dev`, so
 * the port is an argument rather than an environment variable and so killing
 * the child kills the server rather than a shell that owns it. `port` is a
 * parameter rather than a constant here — each caller picks its own fixed
 * number (not random) so a leaked process is still findable by which test
 * file it belongs to.
 */
export async function startTestServer(port: number): Promise<TestServer> {
  const origin = `http://127.0.0.1:${port}`;
  let said = "";
  const remember = (chunk: unknown): void => {
    said = (said + String(chunk)).slice(-MAX_OUTPUT);
  };

  const noServer = (why: string): never => {
    const printed = said.trim();
    throw new Error(
      `${why}\n\n` +
        `── what \`next dev -p ${port}\` printed ──\n` +
        (printed || "(nothing at all — the binary produced no output)") +
        "\n──\n" +
        "If that says another dev server is already running: Next refuses a " +
        "second one for the same project directory whatever port it is given. " +
        "Stop the other one and re-run, or run this file alone in CI, where " +
        "nothing else is serving this project.",
    );
  };

  const tsconfigBefore = readFileSync(TSCONFIG, "utf8");
  const child: ChildProcess = spawn(
    "../node_modules/.bin/next",
    ["dev", "-p", String(port)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      // The dev server is a separate process and reads its own environment.
      // The suite's own `sql` handle (tests/support/db.ts) points at the test
      // database directly; without these two the server would reach for a
      // `DATABASE_URL` the `check` job does not set, and every page would
      // fault instead of rendering.
      env: {
        ...process.env,
        DATABASE_URL: testPoolDatabaseUrl(),
        MIGRATION_DATABASE_URL: testDatabaseUrl(),
      },
    },
  );
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);

  // Three ways this ends badly, each reported the moment it is known rather
  // than at the deadline. A child that refuses to start exits within a second
  // or two; waiting out the full timeout to say so is a misdiagnosis.
  let exit: string | null = null;
  child.on("exit", (code, signal) => {
    exit = signal ? `killed by ${signal}` : `exited with code ${code}`;
  });
  child.on("error", (error) => {
    exit = `could not be spawned: ${error.message}`;
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${origin}/`);
      if (res.ok) {
        await res.text();
        break;
      }
    } catch {
      // Not listening yet.
    }
    // Read through a local: `exit` is assigned from a callback, which
    // TypeScript cannot see, so narrowing it in place would leave it typed
    // `never` here.
    const ended: string | null = exit;
    if (ended) noServer(`\`next dev\` ${ended} before ${port} answered.`);
    if (Date.now() > deadline) {
      noServer(`the dev server never came up on ${port} within 60s.`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    origin,
    async close() {
      child.kill("SIGTERM");
      if (readFileSync(TSCONFIG, "utf8") !== tsconfigBefore) {
        writeFileSync(TSCONFIG, tsconfigBefore);
      }
    },
  };
}
