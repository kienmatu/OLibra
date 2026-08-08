/**
 * The domain's error vocabulary.
 *
 * A closed union rather than a plain `string`, so a typo in a reason code is
 * a type error at the call site instead of a silent mismatch discovered when
 * a screen fails to translate it. Every code carries its Vietnamese sentence
 * here, in the domain, so the two can never drift apart the way a UI-owned
 * copy of the same mapping eventually would — a screen calls
 * `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it
 * did not define.
 *
 * Extended by each domain module that needs a reason code of its own; there
 * is deliberately no separate per-module error file; one closed union keeps
 * `switch`-over-`ErrorCode` exhaustive everywhere it is used.
 */
export type ErrorCode =
  | "parish_unit_l1_not_found"
  | "parish_unit_l2_not_found"
  | "parish_unit_l2_not_in_l1";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  parish_unit_l1_not_found: "Đơn vị bậc 1 đã chọn không tồn tại.",
  parish_unit_l2_not_found: "Đơn vị bậc 2 đã chọn không tồn tại.",
  parish_unit_l2_not_in_l1:
    "Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.",
};
