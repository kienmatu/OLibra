import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * CI and compose must run the same MinIO release.
 *
 * The storage suite runs against a live object store: `compose.yaml`'s
 * `storage` service locally, and a `docker run` step in the `check` job on CI
 * (a service container cannot pass the `server /data` command `minio/minio`
 * needs). Two places naming a release tag is two places to update, and the
 * failure when they drift is the expensive kind — the suite passes on every
 * developer machine against one version and fails on CI against another, or
 * worse, passes on both while production behaves like neither.
 *
 * Same shape and same reason as `ci-supplies-required-env.test.ts`: read the
 * workflow as text, so the failure lands in the suite the author is already
 * running rather than on a badge they have to remember to open. Parsing the
 * YAML would mean agreeing with a parser about anchors and multi-line scalars;
 * "the same tag string appears in both files" is a weaker claim that cannot
 * itself be subtly wrong.
 */
test("CI runs the same MinIO release compose.yaml does", () => {
  // `minio/minio` only — `minio/mc` in the compose bucket-init sidecar is a
  // different image on its own release cadence, and CI deliberately does not
  // run it (the storage suite creates its bucket with `CreateBucketCommand`).
  const tag = /minio\/minio:(\S+)/;

  const inCompose = readFileSync("compose.yaml", "utf8").match(tag)?.[1];
  const inWorkflow = readFileSync(".github/workflows/ci.yml", "utf8").match(
    tag,
  )?.[1];

  expect(inCompose).toMatch(/^RELEASE\./);
  expect(inWorkflow).toBe(inCompose);
});
