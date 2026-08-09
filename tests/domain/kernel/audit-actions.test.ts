import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  actionsInGroup,
  auditGroupFromParam,
  AUDIT_ACTION_NAMES,
  AUDIT_ACTIONS,
  AUDIT_GROUPS,
  type AuditFacts,
  type AuditGroup,
  auditSentence,
} from "../../../src/domain/kernel/audit-actions";
import { filesUnder, stripCommentsAndStrings } from "../../support/source-text";

/**
 * P1 §3.1's totality guard, and the half of it a type cannot express.
 *
 * The primary guarantee is a compile error, not a test:
 * `AuditEntry.action` is `AuditAction`, which is `keyof typeof ACTIONS` in
 * `src/domain/kernel/audit-actions.ts` — the same object that holds each
 * action's Vietnamese sentence. A command cannot write an action with no
 * sentence, because that name does not exist as a type. §3.1 asks for a test as
 * the floor and says why the compiler is better: "a test that runs after the
 * fact is the weaker of the two."
 *
 * **So what is this file for.** Two holes the compiler genuinely cannot see:
 *
 * 1. **An `as AuditAction` cast.** One assertion at one call site silences the
 *    union entirely, and the diff that does it looks like a type fix.
 * 2. **A sentence for an action nothing writes.** The compiler is happy with a
 *    map entry no command names. That is the shape that makes a stale map look
 *    maintained — the reader sees thirty-four sentences and assumes each
 *    describes something that happens.
 *
 * Both are caught the same way: **discover the set from source text**, not from
 * the map, and require the two to be equal in both directions. §3.1's own words
 * are "discovered from the code, not hand-listed", and the list this file
 * discovers is the one the commands actually write.
 *
 * **`src/domain` entire, never the `commands/` directories.** The P1
 * reconciliation found `membership.registered` written by
 * `src/domain/members/registration.ts:402` — a helper three commands share,
 * outside any `commands/` directory. A discovery rule shaped like the folder
 * layout would silently miss exactly one action, and it is the one a
 * *reader-facing* registration writes.
 *
 * **Strings kept, comments removed** — the opposite treatment from
 * `boundaries.test.ts`, because here the thing being matched *is* a string
 * literal, while the docstrings in `audit-actions.ts` and in the commands
 * discuss action names in prose. `stripCommentsAndStrings` would erase the
 * evidence; the local `withoutComments` below keeps it. Same limits every
 * source-text check in this repository declares: an action assembled at runtime
 * is invisible, and it is invisible to the type system too, which is why
 * `AuditEntry.action` being a union is the guard that matters.
 */

/** Comments out, strings in. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every `action: "…"` literal under `src/domain`, with the file it is in. */
function actionsWrittenInSource(): { action: string; file: string }[] {
  const found: { action: string; file: string }[] = [];
  for (const file of filesUnder("src/domain")) {
    // The map itself is where the sentences are declared, not where an action
    // is *written*. Reading it back would make this test compare the map to
    // itself and pass unconditionally.
    if (file.endsWith("kernel/audit-actions.ts")) continue;
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const [, action] of source.matchAll(/\baction:\s*["']([^"']+)["']/g)) {
      found.push({ action, file: file.replace(process.cwd() + "/", "") });
    }
  }
  return found;
}

test("the discovery finds actions outside the commands directories", () => {
  // This test's own guard, and it is not decoration: every assertion below is a
  // set comparison, and a `actionsWrittenInSource()` that found nothing would
  // satisfy "no action is missing a sentence" perfectly. It is also the exact
  // failure the P1 reconciliation predicted — so the shape it predicted is
  // asserted by name rather than by count.
  const found = actionsWrittenInSource();
  expect(found.length).toBeGreaterThan(30);

  const registration = found.filter(
    (f) => f.file === "src/domain/members/registration.ts",
  );
  expect(registration.map((f) => f.action)).toEqual(["membership.registered"]);

  // And a plain command is seen too, so the walk is not somehow reaching only
  // the odd one out.
  expect(found.map((f) => f.action)).toContain("loan.created");
});

test("every action a command writes has a Vietnamese sentence", () => {
  const written = [...new Set(actionsWrittenInSource().map((f) => f.action))];
  const uncovered = written.filter((a) => !Object.hasOwn(AUDIT_ACTIONS, a));

  // Not `toEqual([])` alone: the message has to name the action, because the
  // person reading this failure has just added a command and needs to be told
  // which sentence to write.
  expect(uncovered, `no sentence for: ${uncovered.join(", ")}`).toEqual([]);
});

test("every sentence describes an action a command still writes", () => {
  const written = new Set(actionsWrittenInSource().map((f) => f.action));
  const dead = AUDIT_ACTION_NAMES.filter((a) => !written.has(a));

  expect(dead, `sentence with no writer: ${dead.join(", ")}`).toEqual([]);
});

test("no action is left out of a group, and no group is empty", () => {
  // Totality in the second dimension. The group lives on the same entry as the
  // sentence, so the compiler already guarantees every action has one — what it
  // cannot see is a *group* nothing was ever assigned to, which would render an
  // empty filter chip that silently matches nothing.
  for (const group of Object.keys(AUDIT_GROUPS) as AuditGroup[]) {
    expect(actionsInGroup(group).length, group).toBeGreaterThan(0);
  }
  const grouped = (Object.keys(AUDIT_GROUPS) as AuditGroup[]).flatMap(
    actionsInGroup,
  );
  expect(grouped.sort()).toEqual([...AUDIT_ACTION_NAMES].sort());
});

const NOBODY: AuditFacts = {
  actor: null,
  subject: null,
  before: null,
  after: null,
};
const WHEN = { time: "14:32", date: "03/08/2026" };

test("every sentence renders, for every action, with an empty payload", () => {
  // A payload is `jsonb` written by whichever build was deployed, so every
  // phrase has to survive one that names nothing. A phrase that interpolated an
  // absent field would put "undefined" or "null" in the middle of a sentence on
  // a volunteer's screen; this is the assertion that catches it for all
  // thirty-three at once rather than for the ones somebody thought to test.
  for (const action of AUDIT_ACTION_NAMES) {
    const sentence = auditSentence(action, NOBODY, WHEN);
    expect(sentence, action).not.toMatch(/undefined|null|NaN|\[object/);
    // No sentence leaks the machine name of its own action.
    expect(sentence, action).not.toContain(action);
    // And it is a sentence, not a fragment.
    expect(sentence, action).toMatch(
      /^Hệ thống đã .+ lúc 14:32 ngày 03\/08\/2026$/,
    );
  }
});

test("an action with no sentence never renders its raw name", () => {
  // The failure §3.1 names outright: "`loan.created` on a volunteer's screen is
  // a failure, not a fallback." `audit_log` is append-only, so a row written by
  // an older build with an action this one has retired is a real state and not a
  // programming error — the browser must still render the page, and must still
  // not print the token.
  const sentence = auditSentence("loan.renewed", NOBODY, WHEN);
  expect(sentence).not.toContain("loan.renewed");
  expect(sentence).not.toContain("loan");
  expect(sentence).toBe(
    "Hệ thống đã thực hiện một thao tác hệ thống chưa được mô tả lúc 14:32 ngày 03/08/2026",
  );

  // And the eight names every object in JavaScript inherits are not actions.
  // `"constructor" in AUDIT_ACTIONS` is `true`, and the lookup then returns a
  // *function* whose `.phrase` is `undefined` — a TypeError inside the render,
  // which is the HTTP 500 `?loi=constructor` shipped as on three screens.
  for (const inherited of ["constructor", "toString", "__proto__", "valueOf"]) {
    expect(() => auditSentence(inherited, NOBODY, WHEN)).not.toThrow();
    expect(auditSentence(inherited, NOBODY, WHEN)).toContain("chưa được mô tả");
  }
});

test("a payload's inherited keys are not read as values", () => {
  // The same hazard one level in. `before`/`after` are ordinary objects the
  // driver parsed out of `jsonb`, so `"constructor" in after` is true for every
  // one of them; a phrase reading a field named `constructor` through `in`
  // would interpolate a function body.
  const sentence = auditSentence("book.created", { ...NOBODY, after: {} }, WHEN);
  expect(sentence).toBe(
    "Hệ thống đã thêm sách một cuốn sách lúc 14:32 ngày 03/08/2026",
  );
  expect(sentence).not.toContain("function");
});

test("BR §14's example sentence is what this renders", () => {
  // The requirement, verbatim where it can be: "Quản lý Maria Lan đã cho Giuse
  // Minh mượn Dế Mèn Phiêu Lưu Ký lúc 14:32 ngày 03/08". The role word is
  // deliberately absent — `audit_log` stores no role, and re-reading today's
  // membership would relabel a demoted manager's whole history. See
  // `AuditFacts`' docstring.
  expect(
    auditSentence(
      "loan.created",
      {
        actor: "Maria Lan",
        subject: "Giuse Minh",
        before: { copy_state: "available" },
        after: { copy_state: "on_loan", title: "Dế Mèn Phiêu Lưu Ký" },
      },
      WHEN,
    ),
  ).toBe(
    "Maria Lan đã cho Giuse Minh mượn Dế Mèn Phiêu Lưu Ký lúc 14:32 ngày 03/08/2026",
  );
});

test("a sentence prints the stored value, never today's", () => {
  // P1 §3.2. Two entries for the same book, written before and after a title
  // correction, must read differently — that is the whole point of an audit
  // trail, and it is only true because the title comes out of the payload.
  const was = auditSentence(
    "book.created",
    { ...NOBODY, actor: "Maria Lan", after: { title: "Dế mèn phiêu lưu ký" } },
    WHEN,
  );
  const now = auditSentence(
    "book.updated",
    { ...NOBODY, actor: "Maria Lan", after: { title: "Dế Mèn Phiêu Lưu Ký" } },
    WHEN,
  );
  expect(was).toContain("Dế mèn phiêu lưu ký");
  expect(now).toContain("Dế Mèn Phiêu Lưu Ký");
});

test("a return names the condition through the map that owns the word", () => {
  expect(
    auditSentence(
      "loan.returned",
      {
        actor: "Maria Lan",
        subject: "Têrêsa Lê Ngọc Ánh",
        before: null,
        after: { title: "Hoàng Tử Bé", condition: "perfect" },
      },
      WHEN,
    ),
  ).toBe(
    "Maria Lan đã nhận trả Hoàng Tử Bé từ Têrêsa Lê Ngọc Ánh, tình trạng Nguyên vẹn lúc 14:32 ngày 03/08/2026",
  );

  // A condition value this build has no word for is dropped, not printed raw.
  const unknown = auditSentence(
    "loan.returned",
    { ...NOBODY, after: { title: "Hoàng Tử Bé", condition: "water_damaged" } },
    WHEN,
  );
  expect(unknown).not.toContain("water_damaged");
  expect(unknown).toContain("nhận trả Hoàng Tử Bé");
});

test("`?viec=` resolves only to a real group", () => {
  expect(auditGroupFromParam("muon-tra")).toBe("muon-tra");
  expect(auditGroupFromParam(undefined)).toBeUndefined();
  expect(auditGroupFromParam("khong-co")).toBeUndefined();
  // `"constructor" in AUDIT_GROUPS` is true; `Object.hasOwn` is why this is not.
  expect(auditGroupFromParam("constructor")).toBeUndefined();
});

test("the sentences are Vietnamese, and no English enum spelling leaks", () => {
  // Every phrase is read by a volunteer. An enum value interpolated straight
  // out of a payload — `perfect`, `on_loan`, `active` — is the shape that turns
  // a readable sentence into a half-translated one, and it is what the
  // `CONDITION_LABELS` lookup above exists to prevent. Checked across the whole
  // map rather than per phrase, so a new sentence written next year is checked
  // without anybody adding an assertion.
  const payload = {
    condition: "perfect",
    copy_state: "on_loan",
    status: "active",
    state: "retired",
  };
  for (const action of AUDIT_ACTION_NAMES) {
    const sentence = auditSentence(
      action,
      { ...NOBODY, before: payload, after: payload },
      WHEN,
    );
    for (const enumValue of ["perfect", "on_loan", "active", "retired"]) {
      expect(sentence, `${action} leaked ${enumValue}`).not.toContain(enumValue);
    }
  }
});

test("stripCommentsAndStrings is not what this file uses, and why", () => {
  // A one-line guard on the reading strategy, because reaching for the shared
  // helper here is the natural mistake and it would make every assertion above
  // pass vacuously: it removes string literals, which is exactly what is being
  // matched.
  const sample = 'const a = { action: "loan.created" };';
  expect(stripCommentsAndStrings(sample)).not.toContain("loan.created");
  expect(withoutComments(sample)).toContain("loan.created");
  expect(withoutComments('// action: "not.real"\n')).not.toContain("not.real");
});
