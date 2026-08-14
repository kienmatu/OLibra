import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder, stripCommentsAndStrings } from "../support/source-text";

test("the domain imports no framework", () => {
  // G1 / SDD §3.1. This is what keeps the backend's location (SDD §3.4) a
  // reversible decision: the moment the domain imports `next/*`, moving it to
  // a separate service stops being a packaging change.
  //
  // Catches every form the specifier can arrive in: a static import/export
  // (`from "next/x"`), a side-effect import (`import "next/x"`), a dynamic
  // import (`import("next/x")`), and `require("next/x")`. The last
  // alternative catches a relative reach into src/app (`../../app/layout`)
  // as well as the `@/app/*` alias form — G1 forbids reaching into src/app
  // regardless of how the specifier is spelled, and a relative reach-up is
  // exactly what an editor autocompletes.
  const forbidden =
    /\b(?:from|import|require)\s*\(?\s*["'](?:next(?:\/|["'])|react|@\/app\/|\.\.\/(?:\.\.\/)*app\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not import src/auth", () => {
  // M13. `src/auth/` (guards.ts, session.ts) exists precisely because
  // identity and session-handling sit outside the domain (S3 plan's
  // "Architecture": "Guards live in src/auth/, outside the domain, and
  // produce the TenantContext the domain requires") — the domain takes a
  // `TenantContext` as a plain argument and never resolves one itself. That
  // separation was true by construction until this slice gave `src/auth`
  // something to import; nothing enforced it staying true. Same detection
  // approach as "the domain imports no framework" above: every specifier
  // shape (static, side-effect, dynamic import, `require`, and a relative
  // reach-up out of src/domain) is forbidden, not just `@/auth/*`.
  const forbidden =
    /\b(?:from|import|require)\s*\(?\s*["'](?:@\/auth\/|\.\.\/(?:\.\.\/)*auth\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not import the object store", () => {
  // B5. The domain records *storage keys* and never touches bytes — which is
  // why `src/domain/members/registration.ts` takes `avatarObject` as a string
  // and says so, and why no query derives an address from one: that is
  // `src/lib/avatar-url.ts`'s job, at the surface, because `url()` lives in
  // `src/storage/`. Nothing enforced that until `src/storage/` existed to be
  // imported, and the tempting wrong move for a future `ProposeAvatarChange`
  // is to have the command write the file itself, inside the transaction: a
  // rollback then leaves an object nobody references and no record that it was
  // ever written. This test makes that a failure at the moment it is typed
  // rather than an operational mystery six months later.
  //
  // `@aws-sdk/*` is forbidden alongside `src/storage/` deliberately. Reaching
  // past the store to the SDK it happens to use would satisfy the narrower
  // rule while breaking the same boundary — and would put a provider-specific
  // type in a domain signature, which is the coupling SDD §6.8 exists to
  // prevent. Same specifier shapes as the two checks above.
  const forbidden =
    /\b(?:from|import|require)\s*\(?\s*["'](?:@\/storage\/|\.\.\/(?:\.\.\/)*storage\/|@aws-sdk\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("no component reaches into the fixtures module", () => {
  // Task 12 (2026-08-10 QA remediation). `src/components/ui/book.tsx` called
  // `coverForTitle(title)` from `@/lib/fixtures` on every render, including on
  // pages that read `books.cover_url` from the database — so a title's
  // *artwork* was chosen by matching its *name* against eleven invented
  // fixture books, on every page, database-backed or not. A brand-new parish,
  // Giáo xứ Thánh Tâm, catalogued a book called "Dế Mèn Phiêu Lưu Ký" — the
  // exact title one of the eleven fixtures carries — and the public book page
  // served `public/covers/de-men-phieu-luu-ky.svg`, whose caption line read
  // "Tủ sách Đồng Tháp": a different parish's name, printed on the artwork, on
  // a public page. `books.cover_url` existed in the schema the whole time and
  // was never read.
  //
  // Same detection approach as the three domain-boundary checks above: every
  // specifier shape (static, side-effect, dynamic `import()`, `require`, and a
  // relative reach-up out of wherever a file happens to sit under
  // `src/components/`) is forbidden, not just the `@/lib/fixtures` alias form
  // a straightforward import would use. A file two directories deep writing
  // `../../lib/fixtures` is the same reach by a different spelling, and an
  // editor's autocomplete produces exactly that spelling as readily as the
  // alias.
  const forbidden =
    /\b(?:from|import|require)\s*\(?\s*["'](?:@\/lib\/fixtures|\.\.\/(?:\.\.\/)*lib\/fixtures)["']/;
  const offenders = filesUnder("src/components")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not use Bun-specific APIs", () => {
  // G9. The runtime is Bun, but the build and the tests run on Node, and the
  // domain must stay runnable under both. Comments and strings are stripped
  // first so a comment like `// avoids Bun.file()` doesn't fail the test for
  // zero actual API usage.
  //
  // This is not the only backstop: eslint.config.mjs also restricts the
  // `Bun` global for src/domain/**/*.ts via `no-restricted-globals`. That
  // rule is new — this comment used to (incorrectly) point to "the ESLint
  // rule, which parses a real AST" as if it already covered this, but
  // no-restricted-imports only ever restricted import specifiers, never a
  // bare global reference like `Bun.file()`. Before the no-restricted-globals
  // rule was added, the only thing actually catching a stray `Bun.*` call was
  // `tsc` failing with TS2867 ("Cannot find name 'Bun'") — which holds only
  // because `@types/bun` is not installed; installing it would silently
  // remove that protection.
  const offenders = filesUnder("src/domain")
    .filter((f) => /\bBun\./.test(stripCommentsAndStrings(readFileSync(f, "utf8"))))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
