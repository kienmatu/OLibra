import type { ErrorCode } from "./errors";

/**
 * The shape every blocking-rule predicate returns.
 *
 * Lives in the kernel rather than in any one module because more than one
 * domain needs it: circulation's lending predicates (see the C1 plan) and
 * members' parish-taxonomy selection rule both answer the same "can I?"
 * question the same way, so a picker and the command behind it can share one
 * implementation instead of two that are free to disagree.
 */
export type Block = { blocked: true; reason: ErrorCode } | { blocked: false };
