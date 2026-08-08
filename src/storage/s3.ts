/**
 * The object store — the only thing in this codebase that moves bytes.
 *
 * SDD §6.8 makes a claim this module exists to keep true:
 *
 * > MinIO is an **implementation, not the interface**. The application speaks
 * > S3 and never imports a MinIO SDK, so changing provider is a change of
 * > environment variables — endpoint, region, bucket, credentials — and
 * > nothing else.
 *
 * Until this file existed that sentence was true by vacancy: nothing imported
 * anything, so nothing could import the wrong thing. It is now true by test —
 * `tests/architecture/storage-speaks-s3.test.ts` reads `package.json` and this
 * source and fails on any specifier containing "minio".
 *
 * ## Why `@aws-sdk/client-s3` is here, when `fold()` refused a slugify library
 *
 * This is the decision a future reader is most likely to reverse, because the
 * codebase argues the opposite case a few directories away and the reasoning
 * looks identical. It is not.
 *
 * The three operations below are a PUT, a DELETE and a string. Signing them by
 * hand is about sixty lines of WebCrypto and no dependency — which is exactly
 * the trade `src/domain/kernel/fold.ts` took when it declined `slugify`. But
 * the question that settled the slugify case was *who owns the rule and who
 * notices when it stops being followed*: we own the Vietnamese folding rule,
 * our test defines it, and a library could only ever agree with us by
 * coincidence. SigV4 inverts every clause of that. AWS owns it, we cannot
 * define it, and a hand-rolled signer does not fail loudly — it fails as a 403
 * on some input shape nobody thought to test, in the one part of this slice
 * where being subtly wrong is a security property rather than a cosmetic one.
 *
 * `@aws-sdk/client-s3` is not a MinIO SDK. It is *the* S3 client, which is
 * precisely what "the application speaks S3" means; MinIO, R2 and B2 are all
 * reached through it by changing the seven variables below and nothing else.
 *
 * One property of it has to be arranged rather than assumed: **the ambient AWS
 * credential chain must never be consulted.** Left to itself the SDK reads
 * `AWS_*`, then `~/.aws/credentials`, then — on a timeout measured in seconds —
 * the EC2 instance metadata endpoint. That default would turn a missing
 * `S3_ACCESS_KEY_ID` into a slow, confusing failure on a developer's machine
 * and a *silently different identity* on any host that happens to have an AWS
 * profile. Passing `credentials` explicitly to `S3Client` means the default
 * provider chain is **never invoked** — the word matters, and an earlier
 * version of this comment had it wrong. `credentialDefaultProvider` is always
 * assigned into the client's runtime configuration; what an explicit
 * `credentials` object prevents is it ever being *called*. The substance is
 * unchanged — no `~/.aws` is read, no instance metadata endpoint is dialled —
 * but "never constructed" is a claim about the SDK's internals that is false,
 * and a false reason is worse than no reason. A test in
 * `tests/storage/s3.test.ts` runs the whole store with every `AWS_*` variable
 * deleted from the environment, and then with hostile ones set, to prove the
 * behaviour rather than the mechanism.
 */
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * What the rest of the application is allowed to know about storage.
 *
 * Three operations, no client, no bucket, no SDK types. A caller holding this
 * cannot accidentally depend on which provider is behind it — which is the
 * whole of SDD §6.8's portability claim expressed as a type.
 *
 * There are deliberately no error codes here. `src/domain/kernel/errors.ts` is
 * a closed union of *business-rule* failures, each carrying the Vietnamese
 * sentence a reader is shown. "The object store was unreachable" is not one of
 * those — it is a 500, and putting it in that catalogue would sit an
 * infrastructure fault beside entries that all name something the user can do
 * instead. The SDK's own error propagates.
 */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  url(key: string): string;
  delete(key: string): Promise<void>;
}

/**
 * The seven variables, resolved.
 *
 * `endpoint` and `publicUrl` are separate and must stay separate. The server
 * reaches storage over the internal container network (`http://storage:9000`)
 * while a browser reaches it from outside (`http://localhost:9000`, or a CDN
 * host in production). Conflating them works on a laptop and breaks the moment
 * anything sits behind a proxy — see `url()` below, which uses `publicUrl` and
 * never `endpoint`.
 */
export interface S3Config {
  /**
   * Where the *server* talks to storage. Empty means "AWS S3's own endpoint" —
   * `.env.example` documents that as the AWS row, and it is the one variable
   * of the seven that is legitimately blank.
   */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * SDD §6.10 calls this the flag that carries the portability: MinIO and R2
   * address buckets by path, AWS S3 by host name. It is configuration rather
   * than an assumption precisely so the provider can change without code
   * changing.
   */
  forcePathStyle: boolean;
  /** Where a *browser* fetches an object from. Never `endpoint`. */
  publicUrl: string;
}

/**
 * The only function in this module that reads `process.env`.
 *
 * §7.5's acceptance criterion is that the store reads seven named variables
 * *and nothing else*. That is a code-review exercise in a module which reaches
 * for `process.env.S3_BUCKET` from three places, and a checkable fact in one
 * that reads the environment exactly here — which is what
 * `tests/architecture/storage-speaks-s3.test.ts` checks, by grepping this file
 * for `process.env.` and asserting both the set of names and that every
 * occurrence falls inside this function.
 *
 * It also lets the suite point a store at a test bucket by *constructing* an
 * `S3Config`, rather than mutating `process.env` mid-run — which under
 * `fileParallelism: false` would leak into every later file in the same worker.
 *
 * Each variable is named as a string literal *and* read as a literal property
 * access, which looks redundant. It is not: `process.env[name]` inside a helper
 * would make the seven names invisible to the grep above, and the test would
 * pass over a module reading whatever it liked.
 */
export function s3ConfigFromEnv(): S3Config {
  return validateS3Config({
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: required("S3_REGION", process.env.S3_REGION),
    bucket: required("S3_BUCKET", process.env.S3_BUCKET),
    accessKeyId: required("S3_ACCESS_KEY_ID", process.env.S3_ACCESS_KEY_ID),
    secretAccessKey: required(
      "S3_SECRET_ACCESS_KEY",
      process.env.S3_SECRET_ACCESS_KEY,
    ),
    forcePathStyle: flag("S3_FORCE_PATH_STYLE", process.env.S3_FORCE_PATH_STYLE),
    publicUrl: required("S3_PUBLIC_URL", process.env.S3_PUBLIC_URL),
  });
}

/**
 * Exported for `tests/storage/s3-config.test.ts`, and for that reason only.
 *
 * That is normally a smell, and here it is the lesser one. This function and
 * `flag()` below carry the most emphatic protection claims in the file, and
 * until they had tests both claims were unguarded: replacing `flag`'s body with
 * `return false` left the entire suite green. They take their value as an
 * argument rather than reading it, so testing them directly costs nothing and
 * — unlike driving them through `s3ConfigFromEnv` — does not mutate
 * `process.env`, which under `fileParallelism: false` leaks into every later
 * file in the same worker.
 */
export function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. Copy .env.example to .env; the object store needs ` +
        `all seven S3_* variables (SDD §6.8).`,
    );
  }
  return value.trim();
}

/**
 * Refuses anything but `true` or `false`, rather than treating an unrecognised
 * value as falsy.
 *
 * A typo defaulting to `false` would produce virtual-hosted URLs against MinIO:
 * a broken `<img>` in production and a working one on the machine of whoever
 * set the variable correctly, which is the worst available ordering for
 * finding out.
 */
export function flag(name: string, value: string | undefined): boolean {
  const normalised = (value ?? "").trim().toLowerCase();
  if (normalised === "true") return true;
  if (normalised === "false") return false;
  throw new Error(
    `${name} must be exactly "true" or "false", got: ${JSON.stringify(value)}`,
  );
}

/**
 * A DNS-compatible S3 bucket name: lowercase letters, digits and hyphens, 3–63
 * characters, starting and ending alphanumeric.
 *
 * Deliberately stricter than S3's own rule, in one respect: **a dot is
 * refused**, even though AWS permits one. `url()` addresses a bucket
 * virtual-hosted when `S3_FORCE_PATH_STYLE` is false, and
 * `https://my.olibra.bucket.s3.us-east-1.amazonaws.com/...` does not match the
 * `*.s3.<region>.amazonaws.com` certificate — a wildcard covers one label, not
 * three. Every browser shows a certificate error, and nothing anywhere throws.
 * A bucket name with a dot in it is not a configuration this application can
 * serve, so it is refused where it is written rather than where it breaks.
 *
 * Uppercase is refused for the neighbouring reason: `MyBucket` keeps its case
 * in a path-style URL and is silently lowercased in a virtual-hosted one, so
 * the same variable names two different objects depending on a flag.
 */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * The checks that belong at configuration time rather than at `url()` time.
 *
 * `flag()` above already refuses a `S3_FORCE_PATH_STYLE` it does not recognise,
 * on the grounds that a misconfiguration should fail where it is written. These
 * are the rest of that argument. Without them `url()` has two failure modes
 * that are silent — it returns a plausible string and nothing throws:
 *
 * - a bucket name containing a dot (above);
 * - an `S3_PUBLIC_URL` with no scheme. `cdn.example.org` produces
 *   `cdn.example.org/bucket/a.jpg` path-style, which is a relative URL and
 *   therefore garbage, and throws `Invalid URL` virtual-hosted. The silent
 *   branch is the one MinIO uses, which is to say the one every developer runs,
 *   which is exactly the works-locally-breaks-in-production ordering this
 *   module argues against three times over.
 *
 * `createObjectStore` does not call this: an `S3Config` is the contract, and a
 * caller holding one has already been through here or has constructed it by
 * hand in a test. `tests/support/env.ts` runs the `TEST_S3_*` variables through
 * it for the same reason `s3ConfigFromEnv` does.
 */
export function validateS3Config(config: S3Config): S3Config {
  if (!BUCKET_PATTERN.test(config.bucket)) {
    throw new Error(
      `S3_BUCKET must be a DNS-compatible bucket name — 3 to 63 characters of ` +
        `lowercase letters, digits and hyphens, starting and ending ` +
        `alphanumeric. A dot is refused even though S3 allows one, because ` +
        `"bucket.with.dots" is not covered by the *.s3.<region>.amazonaws.com ` +
        `certificate and every browser would show a certificate error. ` +
        `Got: ${JSON.stringify(config.bucket)}`,
    );
  }

  requireAbsoluteHttpUrl("S3_PUBLIC_URL", config.publicUrl);
  // Empty is the AWS row in `.env.example` — "let the SDK work out its own
  // endpoint". Anything else has to be a real URL.
  if (config.endpoint !== "") {
    requireAbsoluteHttpUrl("S3_ENDPOINT", config.endpoint);
  }

  return config;
}

function requireAbsoluteHttpUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${name} must be an absolute URL including the scheme, e.g. ` +
        `"https://cdn.example.org" rather than "cdn.example.org". ` +
        `Got: ${JSON.stringify(value)}`,
    );
  }

  // `new URL("cdn.example.org:9000")` parses — "cdn.example.org" is a
  // syntactically valid scheme — so the protocol has to be checked as well as
  // the parse, or the commonest form of this mistake still gets through.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `${name} must use http or https, got the scheme ` +
        `${JSON.stringify(url.protocol)} in ${JSON.stringify(value)}. ` +
        `A bare host with a port ("cdn.example.org:9000") parses as a URL ` +
        `whose scheme is the host name, which is why this is checked.`,
    );
  }
}

export function createObjectStore(config: S3Config): ObjectStore {
  const client = new S3Client({
    region: config.region,
    // Blank is AWS's own endpoint; `undefined` is how the SDK is told to work
    // that out for itself, and an empty string is not — it is a parse error.
    endpoint: config.endpoint === "" ? undefined : config.endpoint,
    forcePathStyle: config.forcePathStyle,
    // Explicit, so the default provider chain (`AWS_*`, `~/.aws/credentials`,
    // EC2 instance metadata) is never *invoked* — it is still assigned into the
    // client's runtime configuration, as every SDK client's is. See this file's
    // header for why the distinction is worth spelling out.
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async put(key: string, body: Uint8Array, contentType: string) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    url(key: string) {
      return objectUrl(config, key);
    },

    /**
     * Deleting a key that is not there is not an error, because it is not one
     * in S3 either — `DeleteObject` answers 204 whether or not anything was
     * removed. Preserving that matters to the callers this slice unblocks: the
     * one cleaning up after a rejected avatar proposal should not have to ask
     * whether the upload got far enough to store anything.
     */
    async delete(key: string) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    },
  };
}

/**
 * The one place the application builds an S3 URL itself instead of letting the
 * SDK do it, which is why `forcePathStyle` has to be honoured *here*
 * specifically and not only in the client above.
 *
 * - path-style      → `${publicUrl}/${bucket}/${key}`   (MinIO, Cloudflare R2)
 * - virtual-hosted  → `${scheme}://${bucket}.${host}/${key}`  (AWS S3)
 */
function objectUrl(config: S3Config, key: string): string {
  const base = config.publicUrl.replace(/\/+$/, "");
  const path = encodeKey(key);
  if (config.forcePathStyle) return `${base}/${config.bucket}/${path}`;

  const url = new URL(base);
  url.hostname = `${config.bucket}.${url.hostname}`;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/${path}`;
}

/**
 * Percent-encodes each path segment, leaving the separators alone.
 *
 * `objectKey()` only ever produces `<prefix>/<uuid>.<ext>`, which needs no
 * encoding at all — but `url()` is public and typed `(key: string)`, and B1's
 * covers are not obliged to route through `objectKey()`. Interpolated raw, a
 * key of `avatars/a?b.jpg` emits a URL whose query string starts at the `?`,
 * and a `#` truncates the path outright: in both cases the browser fetches a
 * different object than the one named, or none, and nothing throws.
 *
 * Per segment rather than `encodeURIComponent(key)` wholesale, because the `/`
 * separators are structure and must survive; and `encodeURI` is not the
 * alternative, since it leaves `?` and `#` exactly as they are.
 */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Image extensions a key may end in.
 *
 * An allow-list rather than a sanitiser: the input is ultimately derived from
 * a file a stranger uploaded, and the set of endings that are safe here is
 * small, known and unlikely to grow. Passing the uploaded extension through
 * after stripping the characters we happened to think of is how a key ends
 * `.html` and gets served, from our origin, to a browser.
 */
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/** A single path segment, ASCII, no separators — `avatars`, `book-covers`. */
const PREFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Builds an opaque key: `avatars/9f2c…-…-….jpg`.
 *
 * Keys are **never** derived from the uploaded filename, for two reasons, and
 * the second is the one that matters.
 *
 * **Encoding.** The filename a Vietnamese user uploads is `Nguyễn Văn A.jpg`.
 * Every SigV4 implementation has an opinion about how that is percent-encoded
 * in the canonical URI, and the ones that disagree produce a 403 that appears
 * only for users with diacritics in their names — a bug shaped exactly like
 * the ones this project keeps finding. A UUID has no opinion to disagree with.
 *
 * **Privacy.** The readers here are children. An `S3_PUBLIC_URL` object is
 * fetched by a browser, so its key lands in server logs, proxy logs and
 * browser history. BR §5.3 collects the photograph precisely so a manager can
 * tell two children apart, which makes name-plus-face the most identifying
 * pair of facts in the system; putting the name in the URL of the face
 * publishes that pair to three places nobody audits.
 *
 * Throws on a bad prefix or extension rather than returning a failure: both
 * are programmer errors at a call site with literal arguments, not conditions
 * a reader can do anything about. See `ObjectStore` on why there is no
 * `ErrorCode` here.
 */
export function objectKey(prefix: string, extension: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `Object key prefix must be a single lowercase ASCII segment ` +
        `(e.g. "avatars"), got: ${JSON.stringify(prefix)}`,
    );
  }

  const normalised = extension.trim().toLowerCase().replace(/^\./, "");
  if (!ALLOWED_EXTENSIONS.includes(normalised)) {
    throw new Error(
      `Object key extension must be one of ` +
        `${ALLOWED_EXTENSIONS.join(", ")}, got: ${JSON.stringify(extension)}`,
    );
  }

  return `${prefix}/${crypto.randomUUID()}.${normalised}`;
}
