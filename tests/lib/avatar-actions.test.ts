import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { publicReadPolicy } from "../support/bucket-policy";
import { closeAll, resetDatabase, sql } from "../support/db";
import { makeShelf } from "../support/factories";
import { testDatabaseUrl, testS3Config } from "../support/env";
import { realJpeg, realPng } from "../support/images";

/**
 * The avatar, end to end: a real multipart-shaped upload, a real MinIO, a real
 * session cookie and a real transaction.
 *
 * **This is the first thing in the project that puts bytes anywhere from
 * application code.** B5 shipped `src/storage/s3.ts` with no caller outside its
 * own suite; every claim about ordering between the object store and the
 * database has been reasoning until now. This file is where the reasoning is
 * checked, and the two assertions that carry it are `fetch(url)` returning 200
 * while a proposal is pending and 404 once it is rejected or cancelled — the
 * same shape B5's own suite uses, because a mocked store would agree with any
 * implementation.
 *
 * The ordering being checked is stated in `src/lib/avatar.ts`: the put happens
 * before the transaction (OPS §4.3 requires the manager to be able to look at
 * the image while deciding), and the delete happens after the commit (a delete
 * before a commit that then failed would destroy an image a live request still
 * points at). The residual — commit succeeds, delete fails, one orphan — costs
 * storage rather than correctness and is retryable.
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
}));

const s3 = testS3Config();

const { proposeAvatarAction, cancelProfileChangeAction } =
  await import("../../src/app/tu-sach/[shelf]/(doc-gia)/ho-so/profile-actions");
const { decideAndDiscardAvatar } = await import("../../src/lib/avatar");
const { submitCommand } = await import("../../src/lib/page-data");
const { approveProfileChange } =
  await import("../../src/domain/members/commands/approve-profile-change");
const { proposeProfileChange } =
  await import("../../src/domain/members/commands/propose-profile-change");
const { rejectProfileChange } =
  await import("../../src/domain/members/commands/reject-profile-change");
const { pool } = await import("../../src/db/client");
const { avatarUrl } = await import("../../src/lib/avatar-url");

const clock = fixedClock("2026-08-09T06:00:00Z");

const STORE_KEY = Symbol.for("olibra.storage.object-store");
const POOL_KEY = Symbol.for("olibra.db.pool");

const previous: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  previous[name] = process.env[name];
  process.env[name] = value;
}

beforeAll(async () => {
  // The same trade `page-data.test.ts` and `lending-actions.test.ts` make for
  // the database, applied to the store: the shipped seam reads `process.env`
  // through `s3ConfigFromEnv()` and caches on `globalThis`, so the suite points
  // the seven application variables at its own bucket rather than handing the
  // seam a config production would never pass. Restored in `afterAll` —
  // `fileParallelism: false` means a leaked variable reaches every later file in
  // this worker.
  setEnv("DATABASE_URL", testDatabaseUrl());
  setEnv("S3_ENDPOINT", s3.endpoint);
  setEnv("S3_REGION", s3.region);
  setEnv("S3_BUCKET", s3.bucket);
  setEnv("S3_ACCESS_KEY_ID", s3.accessKeyId);
  setEnv("S3_SECRET_ACCESS_KEY", s3.secretAccessKey);
  setEnv("S3_FORCE_PATH_STYLE", String(s3.forcePathStyle));
  setEnv("S3_PUBLIC_URL", s3.publicUrl);
  delete (globalThis as { [k: symbol]: unknown })[POOL_KEY];
  delete (globalThis as { [k: symbol]: unknown })[STORE_KEY];

  // Same setup as `tests/storage/s3.test.ts`, and for the same two reasons: a
  // bucket that already exists must not fail a re-run, and an S3 bucket is
  // private by default, so `url()` would return a perfectly correct URL that
  // answers 403 to a browser.
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: s3.forcePathStyle,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw error;
    }
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: s3.bucket,
      Policy: JSON.stringify(publicReadPolicy(s3.bucket)),
    }),
  );

  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[POOL_KEY];
  delete (globalThis as { [k: symbol]: unknown })[STORE_KEY];
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await closeAll();
});

async function signInAs(bookshelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${bookshelfId}, ${user.id}, ${role}, 'active')
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id, membershipId: membership.id };
}

/**
 * Signs in as somebody `signInAs` already created, without creating them again.
 *
 * The approval tests below hand the shelf back and forth between the reader and
 * the manager several times, and `signInAs` inserts a `users` row every call —
 * so re-using it for the second visit collides on `users_username_key`.
 */
async function switchTo(username: string): Promise<void> {
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
}

/**
 * A `FormData` carrying a file. `File` is a global in Node 22 and Bun alike, so
 * this is the shape a real multipart POST produces rather than a stand-in.
 */
function uploadForm(fields: Record<string, string>, file?: File): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  if (file) data.append("anh", file);
  return data;
}

// Real, decodable bytes. This was an eight-byte PNG *signature* until the
// pipeline began decoding — sufficient while `invalid_image` was a header
// check, and worthless the moment it became a real one.
const png = async (name = "anh.png") =>
  new File([new Uint8Array(await realPng())], name, { type: "image/png" });

/** See `lending-actions.test.ts`: the real `NEXT_REDIRECT` digest, not a mock. */
async function redirectedTo(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.split(";")[2];
    }
    throw err;
  }
  throw new Error("the action returned without redirecting");
}

function refusalIn(target: string): string | null {
  return new URLSearchParams(target.split("?")[1] ?? "").get("loi");
}

const proposedValues = () =>
  sql<{ id: string; proposed_values: Record<string, string> }[]>`
    select id, proposed_values from profile_change_requests where status = 'pending'
  `.then((r) => r[0]);

/**
 * The address a browser would fetch for a proposal's photograph.
 *
 * Derived from the stored key rather than read off the row: `proposed_values`
 * carries `avatar_object` and nothing else about the image since
 * `20260813_01_avatar_object_only.sql`, and `avatarUrl()` is the one place that
 * turns a key into an address — which is exactly the property that makes
 * changing `S3_PUBLIC_URL` a change of environment and nothing else.
 */
const urlOf = (values: Record<string, string>) => avatarUrl(values.avatar_object)!;

/** What a browser would get from that address. */
const statusOf = (url: string) => fetch(url).then((r) => r.status);

async function shelfWithReader() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await signInAs(shelf.id, "reader", "minh.tran");
  return { shelf, reader };
}

test("a proposed photograph is in the bucket, fetchable, while the request is pending", async () => {
  // OPS §4.3: "the proposed image is stored when the change is proposed, so the
  // manager can look at it while deciding". The `fetch` is the assertion — a
  // mocked store would pass against a put that never happened, against a wrong
  // bucket, and against a `url()` that built the wrong host.
  const { reader } = await shelfWithReader();

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        await png(),
      ),
    ),
  );
  expect(refusalIn(target)).toBeNull();

  // The stored key is always `.webp` now — `objectKey("avatars", "webp")` is a
  // constant call, regardless of what the upload's own content type was (here
  // `image/png`). The bytes are re-encoded to that format by `processAvatar`;
  // this test asserts only the key's shape and that the object is fetchable —
  // "what is stored is a 512×512 WebP, whatever was uploaded" below is what
  // pins the re-encoding itself.
  const request = await proposedValues();
  expect(request.proposed_values.avatar_object).toMatch(
    /^avatars\/[0-9a-f-]+\.webp$/,
  );
  expect(await statusOf(urlOf(request.proposed_values))).toBe(200);
});

test("cancelling deletes the image rather than leaving it orphaned", async () => {
  // The acceptance criterion, asserted the only way it can honestly be
  // asserted: the URL that answered 200 a moment ago answers 404.
  const { reader } = await shelfWithReader();
  await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        await png(),
      ),
    ),
  );
  const request = await proposedValues();
  const url = urlOf(request.proposed_values);
  expect(await statusOf(url)).toBe(200);

  await redirectedTo(
    cancelProfileChangeAction(
      uploadForm({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.membershipId,
        "yeu-cau": request.id,
      }),
    ),
  );

  expect(await statusOf(url)).toBe(404);
});

test("rejecting deletes the image too", async () => {
  // The manager's half. There is no manager screen yet (plan §7 puts screens in
  // a later slice), so this drives the shipped seam directly —
  // `decideAndDiscardAvatar`, which is what that screen's action will call, and
  // which is the only shipped path from a surface to `RejectProfileChange`.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await signInAs(shelf.id, "reader", "minh.tran");
  await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        await png(),
      ),
    ),
  );
  const request = await proposedValues();
  const url = urlOf(request.proposed_values);
  expect(await statusOf(url)).toBe(200);

  await signInAs(shelf.id, "manager", "lan.nguyen");
  await decideAndDiscardAvatar("dong-thap", rejectProfileChange, {
    profileChangeRequestId: request.id,
    reason: "Ảnh bị mờ quá.",
  });

  expect(await statusOf(url)).toBe(404);
});

test("a second photograph deletes the first", async () => {
  // The superseded object. `ProposeAvatarChange` hands its key back; the surface
  // deletes it after the commit, so a reader who changes their mind twice leaves
  // one image in the bucket rather than three.
  const { reader } = await shelfWithReader();
  const fields = { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId };

  await redirectedTo(proposeAvatarAction(uploadForm(fields, await png("mot.png"))));
  const first = urlOf((await proposedValues()).proposed_values);

  await redirectedTo(proposeAvatarAction(uploadForm(fields, await png("hai.png"))));
  const second = urlOf((await proposedValues()).proposed_values);

  expect(second).not.toBe(first);
  expect(await statusOf(first)).toBe(404);
  expect(await statusOf(second)).toBe(200);
});

test("approving a replacement deletes the photograph it replaced", async () => {
  // The retention half. `src/storage/s3.ts` argues that the readers here are
  // children and that name-plus-face is the most identifying pair of facts in
  // the system, so an earlier photograph left answering 200 from a public
  // bucket forever is not a storage cost — it is a family's request the
  // software cannot honour. Approving used to leave exactly that behind.
  //
  // The key is on `users` now, so `ApproveProfileChange` reads the superseded
  // one straight off the `before` half of its own write. It used to have to
  // hunt for it in the approved request that put the old photograph there.
  // Either way this test needs two full rounds — propose, approve, propose,
  // approve — and the assertion is that the first URL, which answered 200
  // through both of them, answers 404 once the second is approved.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await signInAs(shelf.id, "reader", "minh.tran");
  const fields = { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId };

  await redirectedTo(proposeAvatarAction(uploadForm(fields, await png("mot.png"))));
  const first = await proposedValues();
  const firstUrl = urlOf(first.proposed_values);

  await signInAs(shelf.id, "manager", "lan.nguyen");
  await decideAndDiscardAvatar("dong-thap", approveProfileChange, {
    profileChangeRequestId: first.id,
  });
  expect(await statusOf(firstUrl)).toBe(200);

  await switchTo("minh.tran");
  await redirectedTo(proposeAvatarAction(uploadForm(fields, await png("hai.png"))));
  const second = await proposedValues();
  const secondUrl = urlOf(second.proposed_values);
  expect(secondUrl).not.toBe(firstUrl);

  await switchTo("lan.nguyen");
  await decideAndDiscardAvatar("dong-thap", approveProfileChange, {
    profileChangeRequestId: second.id,
  });

  expect(await statusOf(firstUrl)).toBe(404);
  expect(await statusOf(secondUrl)).toBe(200);
});

test("approving a change that is not about the photograph deletes nothing", async () => {
  // The other side of the same decision, and the reason the superseded key is
  // read off `applyProfileFields`' own before/after rather than out of
  // `proposed_values`: a manager approving a phone number must not delete the
  // person's photograph because the two proposals shared one pending row.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await signInAs(shelf.id, "reader", "minh.tran");
  const fields = { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId };

  await redirectedTo(proposeAvatarAction(uploadForm(fields, await png())));
  const proposal = await proposedValues();
  const url = urlOf(proposal.proposed_values);

  await signInAs(shelf.id, "manager", "lan.nguyen");
  await decideAndDiscardAvatar("dong-thap", approveProfileChange, {
    profileChangeRequestId: proposal.id,
  });
  expect(await statusOf(url)).toBe(200);

  // A second, photograph-free proposal, approved. Nothing about the avatar
  // moves, so nothing about the avatar may be deleted.
  await switchTo("minh.tran");
  await submitCommand("dong-thap", proposeProfileChange, {
    membershipId: reader.membershipId,
    fields: { phone: "0912345678" },
  });
  const phoneRequest = await proposedValues();

  await switchTo("lan.nguyen");
  await decideAndDiscardAvatar("dong-thap", approveProfileChange, {
    profileChangeRequestId: phoneRequest.id,
  });

  expect(await statusOf(url)).toBe(200);
});

test("a file over 5 MB is refused, and nothing is stored", async () => {
  // OPS §4.3's `file_too_large` — "Ảnh vượt quá 5 MB." The size is checked
  // before the buffer is read, so the bytes are never materialised; a real
  // oversize `File` is constructed anyway, because a test that declared a size
  // it did not have would pass against an implementation reading
  // `(await arrayBuffer()).byteLength` too late.
  const { reader } = await shelfWithReader();
  const tooBig = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "to.png", {
    type: "image/png",
  });

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        tooBig,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("file_too_large");
  expect(await proposedValues()).toBeUndefined();
});

test("an iPhone HEIC is refused with a sentence that says what to do", async () => {
  // The prebuilt sharp binaries carry libheif but no HEVC codec, so HEIC
  // cannot be decoded. `invalid_image` — "Tệp này không phải là ảnh hợp lệ." —
  // would be both wrong and baffling for a photograph that plainly is one.
  const { reader } = await shelfWithReader();
  const heic = new File([new Uint8Array(2048)], "IMG_0001.HEIC", {
    type: "image/heic",
  });

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        heic,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("heic_not_supported");
  expect(await proposedValues()).toBeUndefined();
});

test("the refusal sentence names five megabytes", async () => {
  // The number a reader is shown and the number enforced are the same fact.
  // Two copies is how one of them survives the next change to the limit.
  const { messageFor } = await import("../../src/domain/kernel/errors");
  const { AVATAR_MAX_BYTES } = await import("../../src/lib/avatar");

  expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  expect(messageFor("file_too_large")).toContain("5 MB");
});

test("a file that is not one of the four image types is refused", async () => {
  // `invalid_image` — "Tệp này không phải là ảnh hợp lệ." An allow-list on the
  // content type, not a sanitiser on the filename: `AVATAR_TYPES`
  // (`src/lib/avatar.ts`) is built from `AVATAR_ACCEPT`
  // (`src/lib/avatar-limits.ts`) — JPEG, PNG, WebP and AVIF — which is what the
  // server accepts. `src/components/avatar-proposal.tsx`'s file input wires its
  // own `accept` attribute to this same list (`accept={AVATAR_ACCEPT.join(",")}`)
  // so a browser offers the identical four types; that is a courtesy the OS file
  // picker may or may not enforce, not a security boundary, so this server-side
  // check is what actually refuses a PDF regardless of what the browser let through.
  const { reader } = await shelfWithReader();
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "anh.pdf", {
    type: "application/pdf",
  });

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        pdf,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("invalid_image");
  expect(await proposedValues()).toBeUndefined();
});

test("a form with no file at all is refused rather than crashing", async () => {
  const { reader } = await shelfWithReader();
  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm({ "tu-sach": "dong-thap", "thanh-vien": reader.membershipId }),
    ),
  );
  expect(refusalIn(target)).toBe("validation_failed");
});

test("a reader may not propose a photograph for somebody else, and nothing is left behind", async () => {
  // Two things at once. The refusal: `requireSelfOrManager` compares
  // `ctx.actor.membershipId`, resolved from the session cookie, against the
  // hidden field — so a rewritten form posts somebody else's membership id and
  // is told no.
  //
  // And the compensation: the bytes were already in the bucket by then, because
  // the put has to happen before the transaction. `src/lib/avatar.ts` deletes
  // what it wrote when the command refuses, which is unambiguously safe — the
  // transaction has rolled back, so no committed row can point at it.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const other = await signInAs(shelf.id, "reader", "khanh.le");
  const reader = await signInAs(shelf.id, "reader", "minh.tran");
  expect(reader.membershipId).not.toBe(other.membershipId);

  const before = await keysInBucket();
  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": other.membershipId },
        await png(),
      ),
    ),
  );

  expect(refusalIn(target)).toBe("not_permitted");
  expect(await proposedValues()).toBeUndefined();
  expect(await keysInBucket()).toEqual(before);
});

test("what is stored is a 512×512 WebP, whatever was uploaded", async () => {
  // The upload is a 2000×1500 JPEG; the object is a square WebP. Fetched over
  // HTTP from the real bucket rather than asserted on a return value, because
  // what a manager and a reader actually see is the object, not the call.
  const sharp = (await import("sharp")).default;
  const { reader } = await shelfWithReader();
  const photo = new File(
    [new Uint8Array(await realJpeg({ width: 2000, height: 1500 }))],
    "anh.jpg",
    { type: "image/jpeg" },
  );

  // `proposeAvatarAction` redirects on every outcome, success included — see
  // `back()` in `profile-actions.ts` — so the call is caught the same way
  // every other test in this file catches it, not awaited bare.
  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        photo,
      ),
    ),
  );
  expect(refusalIn(target)).toBeNull();

  const values = await proposedValues();
  const url = urlOf(values.proposed_values);
  expect(url).toMatch(/\.webp$/);

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const meta = await sharp(bytes).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.width).toBe(512);
  expect(meta.height).toBe(512);
  expect(bytes.length).toBeLessThan(800 * 1024);
});

test("a file wearing an image content-type but holding no image is refused", async () => {
  // `invalid_image` is a decode now, not a header check. Before this it was
  // possible to store an HTML document as long as the browser labelled it a
  // PNG — the module's own docstring conceded as much.
  const { reader } = await shelfWithReader();
  const liar = new File(
    [new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
    "anh.png",
    { type: "image/png" },
  );

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        liar,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("invalid_image");
  expect(await proposedValues()).toBeUndefined();
});

/**
 * Every key under `avatars/`, read with credentials.
 *
 * Anonymous listing is deliberately impossible — the bucket's only public grant
 * is `s3:GetObject`, which `tests/architecture/compose-grants-only-get-object
 * .test.ts` and `tests/storage/s3.test.ts` between them pin — so this uses the
 * SDK. It exists for the one assertion that has to be about *absence*: a
 * refused proposal must leave no object, and there is no URL to `fetch` for an
 * object whose key the test never learned.
 */
async function keysInBucket(): Promise<string[]> {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: s3.forcePathStyle,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: "avatars/" }),
  );
  return (listed.Contents ?? []).map((o) => o.Key!).sort();
}
