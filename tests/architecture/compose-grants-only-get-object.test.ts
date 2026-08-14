import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { publicReadPolicy } from "../support/bucket-policy";

/**
 * The bucket policy that ships must be the bucket policy the suite proves.
 *
 * This test exists because of a hole with a very specific shape. `compose.yaml`
 * opened its bucket with `mc anonymous set download`; `tests/storage/s3.test.ts`
 * opened *its* bucket with a `PutBucketPolicy` granting `s3:GetObject` alone;
 * three comments asserted the two were equivalent. They were not — `download`
 * also grants `s3:ListBucket`, so an unauthenticated `?list-type=2` returned
 * 200 and the key of every avatar, cover and condition photograph. Nothing
 * could have caught it: CI never runs `mc`, and the suite applied its own
 * narrower policy over the top, so the suite was green *precisely because it
 * did not use what ships*. A comment claiming equivalence is exactly the
 * artefact this repository keeps replacing with a test.
 *
 * So: `tests/support/bucket-policy.ts` holds the one definition, the storage
 * suite applies it, and this reads the document out of `compose.yaml` as text
 * and asserts it is the same one.
 *
 * Text rather than a YAML parse, for the reason
 * `ci-pins-the-storage-image.test.ts` gives: parsing would mean agreeing with a
 * parser about block scalars and anchors, and "this exact JSON appears in the
 * file that configures the sidecar" is a weaker claim that cannot itself be
 * subtly wrong.
 */

/**
 * **Both compose files** (2026-08-14, VPS deployment).
 *
 * `compose.prod.yaml` introduces a third copy of this policy document — and it
 * is the copy that guards the real bucket, holding real photographs of real
 * children. The hole this test was written for was two hand-maintained copies
 * drifting apart; a third one, unchecked, is that same hole with production on
 * the unguarded side of it.
 */
const COMPOSE_FILES = ["compose.yaml", "compose.prod.yaml"];

/**
 * A compose file with its comment lines removed.
 *
 * The comments explain at length why `mc anonymous set download` is forbidden,
 * naming it in order to forbid it, and a check for the shorthand's absence that
 * read the raw file would trip on its own rationale — the same incentive
 * `stripCommentsAndStrings` exists to avoid in the architecture tests: never
 * make explaining a rule a way to break it. YAML has one comment form and a `#`
 * inside these files' scalars never begins a line, so a line-level strip is
 * exact here rather than approximate.
 */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/** Compose's own interpolation, left un-substituted in the file on disk. */
const BUCKET_EXPRESSION = "${S3_BUCKET:-olibra}";

test.each(COMPOSE_FILES)(
  "%s's bucket policy is the policy the storage suite applies",
  (file) => {
    const found = code(file).match(/'(\{"Version":.*?\})'/);
    expect(
      found,
      `no bucket policy JSON found in ${file} — the storage-init sidecar ` +
        "must write one out with `mc anonymous set-json`",
    ).not.toBeNull();

    const document = found![1];
    expect(document).toContain(BUCKET_EXPRESSION);

    const bucket = "olibra-test";
    const parsed = JSON.parse(document.replaceAll(BUCKET_EXPRESSION, bucket));

    expect(parsed).toEqual(publicReadPolicy(bucket));
  },
);

test.each(COMPOSE_FILES)(
  "%s does not use the `mc anonymous set` shorthands",
  (file) => {
    // The specific regression. `download` grants `s3:ListBucket` alongside
    // `s3:GetObject`; `public` adds `s3:PutObject` and `s3:DeleteObject` on top
    // of that, which would let anyone on the internet overwrite a child's
    // avatar. Only the explicit document above is allowed, and it is the one
    // the test above compares.
    expect(code(file)).not.toMatch(
      /mc anonymous set\s+(?:download|upload|public)\b/,
    );
    expect(code(file)).toMatch(/mc anonymous set-json\b/);
  },
);

test("the shared policy grants s3:GetObject and nothing else", () => {
  // Guards the single definition itself, which the comparison above cannot:
  // widening `publicReadPolicy` and `compose.yaml` together would leave the two
  // in agreement and the bucket listable again. Written as an equality rather
  // than an absence, so a new action has to be argued for here.
  const policy = publicReadPolicy("any-bucket");

  expect(policy.Statement.flatMap((s) => s.Action)).toEqual(["s3:GetObject"]);
  expect(policy.Statement.flatMap((s) => s.Resource)).toEqual([
    "arn:aws:s3:::any-bucket/*",
  ]);
});
