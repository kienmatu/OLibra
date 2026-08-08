import { expect, test } from "vitest";
import {
  DomainError,
  NotFound,
  RuleViolated,
  ValidationFailed,
  ERROR_MESSAGES,
  isUniqueViolation,
  messageFor,
} from "../../../src/domain/kernel/errors";

test("the three shapes are distinguishable", () => {
  // OPS §2: the UI renders these differently — an inline field error, a named
  // blocking message, and a 404 page. Collapsing them into one class means the
  // UI has to parse strings to tell them apart.
  expect(new NotFound("book_not_found")).toBeInstanceOf(DomainError);
  expect(new NotFound("book_not_found")).not.toBeInstanceOf(RuleViolated);
  expect(new ValidationFailed("validation_failed")).not.toBeInstanceOf(NotFound);
});

test("every error carries a machine code and a Vietnamese sentence", () => {
  const e = new RuleViolated("copy_not_available");
  expect(e.code).toBe("copy_not_available");
  expect(e.message).toBe("Bản sách này đang được mượn hoặc đang giữ chỗ.");
});

test("every declared code has a message", () => {
  // G8 + G7. A code with no message ships an empty dialog to a volunteer; a
  // message with no code is dead copy. Both fail here.
  for (const code of Object.keys(ERROR_MESSAGES)) {
    expect(messageFor(code as never)).not.toBe("");
  }
});

test("a PostgreSQL unique violation is recognisable", () => {
  // SDD §10.3 lists this as disqualifying for a candidate stack: without it,
  // a lost INV-1 race becomes a 500 instead of "Bản sách này vừa được mượn".
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation({ code: "23514" })).toBe(false);
  expect(isUniqueViolation(new Error("boom"))).toBe(false);
});
