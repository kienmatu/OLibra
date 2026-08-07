import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the domain imports no framework", () => {
  // G1 / SDD §3.1. This is what keeps the backend's location (SDD §3.4) a
  // reversible decision: the moment the domain imports `next/*`, moving it to
  // a separate service stops being a packaging change.
  const forbidden = /from\s+["'](next(\/|["'])|react|@\/app\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not use Bun-specific APIs", () => {
  // G9. The runtime is Bun, but the build and the tests run on Node, and the
  // domain must stay runnable under both.
  const offenders = filesUnder("src/domain")
    .filter((f) => /\bBun\./.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
