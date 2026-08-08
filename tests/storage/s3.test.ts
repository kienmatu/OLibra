import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { beforeAll, expect, test } from "vitest";
import { createObjectStore, objectKey, type S3Config } from "../../src/storage/s3";
import { publicReadPolicy } from "../support/bucket-policy";
import { testS3Config } from "../support/env";

/**
 * The object store, against a real MinIO.
 *
 * Nothing here is mocked, and that is the point. A mocked S3 client would
 * assert that we call the SDK the way we think we call it — the claim least
 * likely to be wrong and the one that would still pass if signing, path-style
 * addressing or the public URL were all broken. This suite's central case is
 * therefore a genuine `fetch()` of what `put()` just wrote, which is the only
 * way to check SDD §6.8's "a browser can fetch what the server wrote" rather
 * than restate it. It is the same reasoning that runs the database suite
 * against real PostgreSQL with real RLS.
 *
 * Locally that MinIO is the `storage` service in `compose.yaml`; in CI it is a
 * `docker run` step in the `check` job, because a GitHub service container
 * cannot pass the `server /data` command `minio/minio` needs.
 */

const config = testS3Config();

/**
 * The bucket is created here rather than by `mc` in a compose sidecar: one
 * less image to pull in CI and one less tag to keep pinned. `CreateBucket` on
 * a bucket that already exists is an error rather than a no-op, and which
 * error depends on the region, so both spellings are swallowed — re-running
 * the suite against a warm MinIO must not fail on setup.
 *
 * The anonymous read policy is applied for the same reason, and it is the one
 * piece of setup that is *not* an artefact of testing: an S3 bucket is private
 * by default, so `url()` returning a perfectly correct URL that answers 403 to
 * a browser is the natural state of a fresh deployment. This suite found that
 * — the fetch cases below failed against a bucket the compose sidecar had
 * created exactly the way production would — so `compose.yaml`'s
 * `storage-init` opens the real bucket too.
 *
 * The policy comes from `tests/support/bucket-policy.ts` rather than being
 * spelled out here, and `tests/architecture/compose-grants-only-get-object.test.ts`
 * asserts `compose.yaml` writes that same document. It used to be spelled out
 * here, with a comment claiming compose's `mc anonymous set download` was
 * "the equivalent policy". It was not: `download` also grants `s3:ListBucket`,
 * so the shipped bucket answered an unauthenticated `?list-type=2` with the key
 * of every avatar in it, and this suite stayed green because it applied its own
 * narrower policy over the top — green *because* it did not use what ships.
 *
 * SDD §6.8 and the plan's §5 settle that these objects *are* public: covers
 * and avatars are fetched directly by a browser and nothing in the
 * requirements needs a private object, which is why there are no presigned
 * URLs anywhere in this module.
 */
beforeAll(async () => {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw error;
    }
  }

  await client.send(
    new PutBucketPolicyCommand({
      Bucket: config.bucket,
      Policy: JSON.stringify(publicReadPolicy(config.bucket)),
    }),
  );
});

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("an object that was put is fetchable at url(), byte for byte", async () => {
  // The acceptance criterion in one test: the server writes through the SDK,
  // and something with no knowledge of the SDK — `fetch`, which is what an
  // `<img>` tag amounts to — reads the same bytes back from the URL the store
  // hands out. Content type is asserted alongside because a cover served as
  // `application/octet-stream` downloads instead of rendering, which is a
  // broken page rather than an error anyone sees in a log.
  const store = createObjectStore(config);
  const key = objectKey("test-fixtures", "png");

  try {
    await store.put(key, BYTES, "image/png");

    const response = await fetch(store.url(key));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  } finally {
    await store.delete(key);
  }
});

test("delete removes the object — the same URL then 404s", async () => {
  const store = createObjectStore(config);
  const key = objectKey("test-fixtures", "png");

  await store.put(key, BYTES, "image/png");
  expect((await fetch(store.url(key))).status).toBe(200);

  await store.delete(key);
  expect((await fetch(store.url(key))).status).toBe(404);
});

test("the public bucket cannot be listed anonymously", async () => {
  // The behavioural half of `compose-grants-only-get-object.test.ts`. That one
  // proves compose ships this exact policy document; this proves the document
  // means what it says, against a real MinIO, by doing what an attacker would
  // do — `GET /<bucket>/?list-type=2` with no credentials.
  //
  // This is what `mc anonymous set download` failed: it answered 200 and
  // paginated every key in the bucket. Avatars are photographs of children, and
  // `objectKey()`'s opaque UUIDs stop being privacy the moment a stranger can
  // ask for the list.
  const store = createObjectStore(config);
  const key = objectKey("test-fixtures", "png");

  try {
    await store.put(key, BYTES, "image/png");

    // Path-style, which is what MinIO and the `TEST_S3_*` variables use; the
    // assertion is about the policy, not the addressing style.
    expect(config.forcePathStyle).toBe(true);
    const listing = await fetch(
      `${config.publicUrl.replace(/\/+$/, "")}/${config.bucket}/?list-type=2`,
    );

    expect(listing.status).not.toBe(200);
    expect(await listing.text()).not.toContain(key);
  } finally {
    await store.delete(key);
  }
});

test("delete of a key that was never there does not throw", async () => {
  // S3's own semantics, preserved deliberately. The caller this unblocks is
  // the cleanup path of a rejected avatar proposal (B2b): it must be able to
  // delete unconditionally rather than ask first, because "did the upload get
  // far enough to store anything" is a question with a race in it.
  const store = createObjectStore(config);

  await expect(
    store.delete(objectKey("test-fixtures", "png")),
  ).resolves.toBeUndefined();
});

test("url() addresses the bucket by path when forcePathStyle is set", () => {
  // MinIO and Cloudflare R2. Checked by construction rather than against a
  // live server because the failure being guarded is the *other* branch
  // silently working locally — see the virtual-hosted case below.
  const store = createObjectStore({
    ...config,
    bucket: "olibra-test",
    publicUrl: "https://files.example.org",
    forcePathStyle: true,
  });

  expect(store.url("avatars/abc.jpg")).toBe(
    "https://files.example.org/olibra-test/avatars/abc.jpg",
  );
});

test("url() addresses the bucket by host name when forcePathStyle is not set", () => {
  // AWS S3. This is the branch nobody exercises locally, because compose runs
  // MinIO and MinIO is path-style: getting it wrong produces a working `<img>`
  // on every developer machine and a broken one in production, which is the
  // worst available ordering for finding out.
  const store = createObjectStore({
    ...config,
    bucket: "olibra-test",
    publicUrl: "https://s3.ap-southeast-1.amazonaws.com",
    forcePathStyle: false,
  });

  expect(store.url("avatars/abc.jpg")).toBe(
    "https://olibra-test.s3.ap-southeast-1.amazonaws.com/avatars/abc.jpg",
  );
});

test("url() is built from the public URL and never from the endpoint", async () => {
  // §7.5's explicit criterion, and not a hypothetical distinction: in compose
  // these two genuinely differ (`http://storage:9000` on the container network
  // versus `http://localhost:9000` from a browser). A store whose `url()` used
  // the endpoint would emit `<img src="http://storage:9000/...">`, which
  // resolves inside the network and nowhere else.
  const endpointOnly = "http://not-reachable-from-a-browser.invalid:9000";
  const store = createObjectStore({
    ...config,
    endpoint: endpointOnly,
    publicUrl: "https://cdn.example.org",
  });

  const url = store.url("avatars/abc.jpg");
  expect(url.startsWith("https://cdn.example.org/")).toBe(true);
  expect(url).not.toContain("not-reachable-from-a-browser.invalid");

  // And the two really are independent: a store pointed at the live endpoint
  // but told the public URL is somewhere else still writes successfully.
  const live = createObjectStore({
    ...config,
    publicUrl: "https://cdn.example.org",
  });
  const key = objectKey("test-fixtures", "png");
  await live.put(key, BYTES, "image/png");
  expect(live.url(key)).toBe(`https://cdn.example.org/${config.bucket}/${key}`);
  await live.delete(key);
});

test("objectKey is ASCII, unique per call, and refuses an unlisted extension", () => {
  const keys = new Set(
    Array.from({ length: 100 }, () => objectKey("avatars", "jpg")),
  );
  expect(keys.size).toBe(100);

  for (const key of keys) {
    expect(/^[\x20-\x7e]+$/.test(key)).toBe(true);
    expect(key).toMatch(/^avatars\/[0-9a-f-]{36}\.jpg$/);
  }

  // The reason the allow-list exists: a key ending `.html`, served from our
  // own origin, is stored cross-site scripting. `..` and a path separator are
  // the same class of input arriving through the other argument.
  expect(() => objectKey("avatars", "html")).toThrow();
  expect(() => objectKey("avatars", "svg")).toThrow();
  expect(() => objectKey("avatars", "jpg/../../etc/passwd")).toThrow();
  expect(() => objectKey("../avatars", "jpg")).toThrow();
  expect(() => objectKey("hình ảnh", "jpg")).toThrow();

  // Case and a leading dot are normalised rather than rejected — `extname()`
  // hands a caller ".JPG" and that is not a different file type.
  expect(objectKey("avatars", ".JPG")).toMatch(/\.jpg$/);
});

test("the store needs no ambient AWS credentials", async () => {
  // Left to itself the SDK resolves credentials from `AWS_*`, then
  // `~/.aws/credentials`, then the EC2 instance metadata endpoint — which
  // would mean a machine with an AWS profile silently signing as a different
  // identity, and a machine without one waiting on a metadata timeout before
  // failing. Passing `credentials` explicitly means that chain is never built;
  // this is what proves it, first with no `AWS_*` at all and then with hostile
  // ones, since only the second half distinguishes "never consulted" from
  // "consulted and happened to be empty".
  const saved: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("AWS_")) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  }

  const store = createObjectStore(config);
  const key = objectKey("test-fixtures", "png");

  try {
    await store.put(key, BYTES, "image/png");
    expect((await fetch(store.url(key))).status).toBe(200);
    await store.delete(key);

    process.env.AWS_ACCESS_KEY_ID = "wrong-on-purpose";
    process.env.AWS_SECRET_ACCESS_KEY = "wrong-on-purpose";
    process.env.AWS_REGION = "eu-north-1";

    const second = createObjectStore(config);
    const secondKey = objectKey("test-fixtures", "png");
    await second.put(secondKey, BYTES, "image/png");
    expect((await fetch(second.url(secondKey))).status).toBe(200);
    await second.delete(secondKey);
  } finally {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    for (const [name, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});

// A compile-time check that `testS3Config()` really produces the module's own
// config type; if the two ever drift, this file stops type-checking rather
// than failing at runtime against a half-configured client.
const _typecheck: S3Config = config;
void _typecheck;
