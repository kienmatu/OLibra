/**
 * Parses every mermaid block in docs/ and fails if any of them is malformed.
 *
 * A broken diagram is invisible in review — the markdown looks fine and the
 * failure only appears when someone opens the file on GitHub. This turns that
 * into a check you can run.
 *
 *   bun run check:diagrams
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer";

const DOCS = "docs";

/** Recursive, so diagrams in docs/superpowers/plans/ are checked too. */
function markdownUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownUnder(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const files = markdownUnder(DOCS);

const blocks = [];
for (const file of files) {
  const md = readFileSync(file, "utf8");
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m;
  let i = 0;
  while ((m = re.exec(md))) blocks.push({ file, index: ++i, code: m[1] });
}

if (blocks.length === 0) {
  console.log("no mermaid blocks found");
  process.exit(0);
}
console.log(`checking ${blocks.length} mermaid block(s)\n`);

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({
  path: resolve("node_modules/mermaid/dist/mermaid.min.js"),
});
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));

let failed = 0;
for (const b of blocks) {
  const error = await page.evaluate(async (code) => {
    try {
      await window.mermaid.parse(code);
      return null;
    } catch (e) {
      return String(e?.message ?? e)
        .split("\n")
        .slice(0, 4)
        .join(" | ");
    }
  }, b.code);

  const label = `${b.file} #${b.index}`;
  if (error) {
    failed += 1;
    console.log(`FAIL  ${label}\n      ${error}\n`);
  } else {
    console.log(`ok    ${label}`);
  }
}

await browser.close();
console.log(failed ? `\n${failed} block(s) failed` : "\nall blocks parse");
process.exit(failed ? 1 : 0);
