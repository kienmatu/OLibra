# B5 · Object storage

**Slice:** master plan §7.5. **Blocked by:** S2 only — genuinely parallel with every domain slice.
**Blocks:** `ProposeAvatarChange` (B2b), cover images (B1's surface), condition photographs (C1).

---

## 1. What this slice is

One adapter. The application speaks S3; MinIO is what happens to run in
`compose.yaml`. SDD §6.8 states the rule this slice exists to make true in code:

> The distinction that matters is that **MinIO is an implementation, not the
> interface**. The application speaks S3 and never imports a MinIO SDK, so
> changing provider is a change of environment variables — endpoint, region,
> bucket, credentials — and nothing else.

That claim is currently unfalsifiable: there is no `src/storage/`, so nothing
imports anything, and the sentence is true by vacancy. After this slice it is
true by test.

## 2. Reconciliation against shipped code

Every plan in this project has gone stale before execution, so this section
comes before the work rather than after it. Checked against `main` at `8fee87e`:

| §7.5 says | Live code says | Consequence |
|---|---|---|
| Files: `src/storage/s3.ts`, `tests/domain/storage/s3.test.ts` | `src/storage/` does not exist; `tests/domain/` holds domain tests only | The tests do **not** go under `tests/domain/` — the store is not domain code. `tests/storage/`. |
| "Depends on S2 for the error taxonomy" | `src/domain/kernel/errors.ts` is a closed union of *business* failures with Vietnamese sentences | The store raises **no** `ErrorCode`. See §5. |
| B2 stubs the avatar until B5 lands | `src/domain/members/registration.ts:38-47` takes `avatarUrl` as a URL string and says so in a comment naming this plan | The seam already exists and is correct. B5 does **not** change the domain. |
| — | `tests/domain/members/register-membership.test.ts:134` — "an avatar is a URL the domain records, never bytes it stores" | Already guards the seam. Leave it alone. |
| — | `tests/architecture/boundaries.test.ts` guards `src/domain` only | `src/storage/` is outside it, correctly — but nothing stops the domain importing the store. See §6, task 5. |
| — | `compose.yaml:85-114` already runs MinIO and creates the bucket | Local development needs no new infrastructure. CI does. |
| — | `.env.example:50-62` already documents all seven variables plus `S3_PORT`/`S3_CONSOLE_PORT` | Nothing to add there except the test variables. |

**Nothing in this slice is blocked.** The seam is clean and the plan matches
what is on disk. This is the second slice (after B1) to need no corrections.

## 3. The interface

§7.5 specifies it. One change, stated below.

```ts
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  url(key: string): string;
  delete(key: string): Promise<void>;
}
```

**The change: construction is split from configuration.**

```ts
export function s3ConfigFromEnv(): S3Config;          // the only reader of process.env
export function createObjectStore(config: S3Config): ObjectStore;
```

§7.5's acceptance criterion is that the module reads seven named variables *and
nothing else*. That is only checkable if there is exactly one function that
reads the environment — a module that calls `process.env.S3_BUCKET` from three
places makes the claim a code-review exercise. It also lets the tests point at a
test bucket without mutating `process.env` mid-suite, which under
`fileParallelism: false` would still leak across files in the same worker.

## 4. Decisions

### 4.1 `@aws-sdk/client-s3`, not hand-rolled SigV4

The three operations are a PUT, a DELETE, and a string. Signing them by hand is
roughly sixty lines of WebCrypto and no dependency, which is the choice this
codebase made for `fold()` over a slugify library.

**It is the wrong choice here, and the difference is worth naming, because the
same reasoning produced opposite answers.** The slugify question was *who
notices when it stops* — and the answer was that we own the folding rule, our
test defines it, and a library could only ever agree with us by coincidence.
SigV4 is the inverse: AWS owns it, we cannot define it, and a hand-rolled
signer's failure mode is a 403 on some input shape we did not think to test.
Signing is also the one part of this slice where being subtly wrong is a
security property rather than a cosmetic one.

§7.5 forbids a *MinIO* SDK. `@aws-sdk/client-s3` is not one — it is the S3
client, which is precisely what "the application speaks S3" means. It runs
identically under Node (the test runner) and Bun (production).

Two things to verify rather than assume, both of which have a gate already:

- **It must not consult the ambient AWS credential chain.** Credentials,
  region and endpoint are passed explicitly, so the default provider chain —
  which reads `AWS_*`, `~/.aws/credentials`, and on a timeout the EC2 instance
  metadata endpoint — is never constructed. A test asserts the store works with
  no `AWS_*` variables set at all.
- **It must survive the Bun runtime and the standalone build.** The Docker
  `smoke` stage already boots the built server under Bun and fails the build if
  it does not serve the landing page. If the SDK breaks either, CI's `image`
  job goes red.

### 4.2 Object keys are opaque, and this slice owns that rule

Beyond §7.5, deliberately. One helper:

```ts
export function objectKey(prefix: string, extension: string): string;
// → "avatars/9f2c…-…-….jpg"
```

Two reasons, and the second is the one that matters:

- **Encoding.** A key derived from an uploaded filename is `Nguyễn Văn A.jpg`.
  Every S3 signing implementation has an opinion about how that is
  percent-encoded in the canonical URI, and disagreements there are exactly the
  class of bug that appears only for Vietnamese users. A key of
  `avatars/<uuid>.<ext>` is ASCII and has no opinion to disagree with.
- **Privacy.** Readers here are children. `S3_PUBLIC_URL` objects are fetched
  by a browser and the URL appears in server logs, proxy logs and browser
  history. A key containing a child's name puts it in all three. This is not a
  hypothetical preference — BR §5.3 collects the photograph so a manager can
  tell two children apart, which is the most identifying pair of facts in the
  system.

The extension is validated against a small allow-list rather than passed
through, so a key can never end `.html` or carry a path separator.

### 4.3 `url()` honours `S3_FORCE_PATH_STYLE`

SDD §6.10 calls this the flag that carries the portability. It has to be
honoured in `url()` specifically, because that is the one place where the
application constructs an S3 URL itself rather than letting the SDK do it:

- path-style → `${S3_PUBLIC_URL}/${bucket}/${key}` (MinIO, R2)
- virtual-hosted → `${scheme}://${bucket}.${host}/${key}` (AWS S3)

Both get a test. Getting this wrong produces a broken `<img>` in production and
a working one locally, which is the worst available failure ordering.

`url()` is built from `S3_PUBLIC_URL` and never from `S3_ENDPOINT` — §7.5's
explicit criterion. In compose these differ (`http://storage:9000` versus
`http://localhost:9000`), so the local stack already exercises the distinction.

### 4.4 Tests run against a real MinIO

This codebase does not mock its infrastructure — the whole test suite runs
against a real PostgreSQL with real RLS, because the bugs found this way were
the ones that mattered (`security_invoker` removed, all 101 tests still green).
A mocked S3 client here would assert that we call the SDK the way we think we
call it, which is the claim least likely to be wrong.

So `put` and `delete` hit a live MinIO, and the *proof* for `url()` is a real
`fetch` of what `put` just wrote — which is the only way to check §7.5's
"a browser can fetch what the server wrote" rather than restating it.

Locally that is the `storage` service already in `compose.yaml`. In CI it is a
`docker run` step rather than a service container, because GitHub service
containers cannot pass a command and `minio/minio` needs `server /data`. The
step pins the same release tag `compose.yaml` does, and a test asserts the two
stay pinned together — the same shape as
`tests/architecture/ci-supplies-required-env.test.ts`, and for the same reason:
the failure should land in the suite the author is running, not on a badge they
have to remember to open.

### 4.5 A bucket guard, mirroring the database guard

`tests/support/env.ts` refuses a `TEST_DATABASE_URL` that does not name
`olibra_test`, because the suite truncates every table and a one-character slip
would destroy the development database. The storage tests **delete objects**,
so they carry the same hazard and get the same guard: `TEST_S3_BUCKET` must
contain `test`, checked before a connection is opened.

## 5. What this slice does not do

Named because each is a place a reviewer might reasonably expect something.

- **No `ErrorCode`s.** `errors.ts` is a closed union of business-rule failures,
  each carrying the Vietnamese sentence a reader sees. "The object store was
  unreachable" is not a business-rule failure; it is a 500, and inventing
  `storage_unavailable` there would put an infrastructure fault in a catalogue
  whose every other entry names something the user can do instead. The store
  lets the SDK's error propagate.
- **No file-size or image validation.** `file_too_large` and `invalid_image`
  are `ProposeAvatarChange`'s failure modes (OPS §4.3) and belong to B2b. The
  store puts bytes.
- **No `ProposeAvatarChange`.** B2b.
- **No presigned URLs.** Nothing in the requirements needs a private object;
  covers and avatars are public. Adding signing for reads would be inventing a
  requirement.
- **No domain change.** The seam at `registration.ts:38-47` is already right.

## 6. Tasks

Sequential where noted; 2 and 3 are independent of each other.

**1 — Dependency and configuration.** Add `@aws-sdk/client-s3`. Add
`TEST_S3_*` to `.env.example`. Extend `tests/support/env.ts` with
`testS3Config()` carrying the §4.5 bucket guard, and extend
`tests/architecture/ci-supplies-required-env.test.ts`'s `REQUIRED_IN_CI` list —
that test's second case will fail until the new variables are added to it,
which is the intended behaviour and the reason it exists.

**2 — `src/storage/s3.ts`.** `S3Config`, `s3ConfigFromEnv`, `createObjectStore`,
`objectKey`. Documented to the standard of `src/domain/kernel/fold.ts`: the
file should say why the AWS SDK is here and why MinIO's is not, because that is
the decision a future reader will otherwise reverse.

**3 — CI.** The MinIO `docker run` step in the `check` job, pinned to
`compose.yaml`'s release tag. Bucket creation happens in test setup via
`CreateBucketCommand`, not `mc` — one less image to pull and one less thing to
pin.

**4 — `tests/storage/s3.test.ts`.** Against live MinIO:
- a `put` then a real `fetch` of `url(key)` returns the same bytes and the
  content type that was passed
- `delete` removes it — the same `fetch` then 404s
- `delete` of a key that does not exist does not throw (S3 semantics; a caller
  cleaning up a rejected proposal must not have to check first)
- `url()` path-style and virtual-hosted, both by construction
- `url()` uses `S3_PUBLIC_URL` — a config whose endpoint and public URL differ
  produces the public one
- `objectKey` is ASCII, unique across calls, and rejects an extension outside
  the allow-list
- the store works with every `AWS_*` variable deleted from the environment

**5 — `tests/architecture/boundaries.test.ts`: the domain does not import the
store.** The domain records URLs and never touches bytes — that is why
`registration.ts` takes a string. Nothing currently enforces it, and the
tempting wrong move for a future `ProposeAvatarChange` is to have the command
store the file itself, inside the transaction, which would leave an orphaned
object on rollback. This test is what makes that show up as a failure rather
than as an operational mystery six months later.

**6 — Documentation.** SDD §6.8 gains a pointer to the module; `.env.example`
already documents the seven variables and needs only the test additions.

## 7. Acceptance

Restating §7.5's criteria plus what this plan adds:

- [ ] The module reads `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
      `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`,
      `S3_PUBLIC_URL` **and nothing else**, from exactly one function
- [ ] **No MinIO SDK is imported** — asserted by a dependency test over
      `package.json` and the source, not by a comment
- [ ] `url()` is built from `S3_PUBLIC_URL`, and a browser-equivalent `fetch`
      of it returns what the server wrote
- [ ] Both path-style and virtual-hosted addressing are tested
- [ ] No ambient AWS credential chain: the suite passes with `AWS_*` unset
- [ ] The domain imports nothing from `src/storage/`
- [ ] CI's MinIO release tag and `compose.yaml`'s cannot drift silently
- [ ] `bun run check` green, and CI green — checked on the PR, not locally
