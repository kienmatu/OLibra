/**
 * Crawls the running app and reports internal links that 404.
 *
 * An earlier version tried to resolve links by reading the source. It kept
 * being wrong in both directions: it missed template literals entirely, then
 * once taught to expand them it invented links that do not exist, because two
 * different nav arrays live in one file and a regex cannot tell them apart.
 *
 * Rendering the pages and reading the hrefs Next actually emitted removes all
 * of that guesswork — the router is the authority on what a route is.
 *
 *   docker compose up -d
 *   bun run db:migrate && bun run db:seed
 *   bun run dev              # in another terminal
 *   bun run check:links
 *
 * **It crawls signed in, and as of U1 it has to.** This used to be an
 * anonymous crawler, because every page rendered from `src/lib/fixtures.ts`
 * and a stranger could see all forty-seven of them. `quan-ly/cho-muon` is now
 * a real database read behind `requireManager`, and U1 §3.4's answer for a
 * caller who may not see a manager screen is `notFound()` — so an anonymous
 * crawl gets a perfectly correct 404 and reports it as a dead link. Adding
 * the page to some exception list would have made the crawler blind to the
 * thing it exists to catch, on exactly the pages that are about to gain real
 * behaviour.
 *
 * The session is minted through `signIn` — the same function the sign-in form
 * calls, against the same `sessions` table — rather than by forging a cookie,
 * so a change that breaks real sign-in breaks this too instead of quietly
 * outliving it. It needs the seeded database that `bun run db:seed` builds:
 * `CHECK_LINKS_USER` defaults to the account that seed makes a manager of Đồng
 * Tháp, which is the shelf every `S`-prefixed seed URL below names.
 */
import { connect } from "../src/db/client.ts";
import { signIn } from "../src/auth/session.ts";
import { systemClock } from "../src/domain/kernel/clock.ts";
import { SEED_DEV_PASSWORD } from "../src/db/seed.ts";
import { SESSION_COOKIE } from "../src/lib/session-cookie.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const S = "/tu-sach/dong-thap";

/** Seeds: one concrete URL per route shape, so every page gets rendered once. */
const SEEDS = [
  "/",
  "/tu-sach",
  "/dang-nhap",
  "/dang-ky",
  "/lien-he",
  "/loi",
  S,
  `${S}/danh-muc`,
  `${S}/tim-kiem`,
  `${S}/thong-bao`,
  `${S}/gop-y`,
  `${S}/tang-sach`,
  `${S}/sach/de-men-phieu-luu-ky`,
  `${S}/toi`,
  `${S}/toi/lich-su`,
  `${S}/toi/tang-sach`,
  `${S}/toi/ho-so`,
  `${S}/toi/thong-bao`,
  `${S}/quan-ly`,
  `${S}/quan-ly/cho-muon`,
  `${S}/quan-ly/cho-muon/nguoi-doc`,
  `${S}/quan-ly/cho-muon/xac-nhan`,
  `${S}/quan-ly/nhan-tra`,
  `${S}/quan-ly/nhan-tra/bao-mat`,
  `${S}/quan-ly/qua-han`,
  `${S}/quan-ly/dang-ky-cho-duyet`,
  `${S}/quan-ly/doi-thong-tin`,
  `${S}/quan-ly/yeu-cau-muon`,
  `${S}/quan-ly/binh-luan`,
  `${S}/quan-ly/tang-sach`,
  `${S}/quan-ly/sach`,
  `${S}/quan-ly/sach/mat`,
  `${S}/quan-ly/sach/moi`,
  `${S}/quan-ly/sach/de-men-phieu-luu-ky`,
  `${S}/quan-ly/nguoi-doc`,
  `${S}/quan-ly/nguoi-doc/moi`,
  `${S}/quan-ly/nguoi-doc/minh`,
  `${S}/quan-ly/thong-ke`,
  `${S}/quan-ly/thong-bao`,
  `${S}/quan-ly/cai-dat`,
  "/quan-tri",
  "/quan-tri/tu-sach",
  "/quan-tri/quan-ly-vien",
  "/quan-tri/quan-ly-vien/lan",
  "/quan-tri/nhat-ky",
  "/quan-tri/gop-y",
  "/quan-tri/cai-dat",
];

/**
 * A real session for a real seeded manager.
 *
 * Connects with `MIGRATION_DATABASE_URL` — the superuser handle — rather than
 * `DATABASE_URL`: this is a developer tool writing a row on the caller's
 * behalf, not the application serving a request, and `signIn` inserts into
 * `sessions` directly rather than through the kernel's scoped transaction.
 *
 * Failures here are fatal and say why. A crawler that silently fell back to an
 * anonymous crawl would report every manager page as a dead link and blame the
 * links.
 */
async function signInForCrawl() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error(
      "MIGRATION_DATABASE_URL is not set. The crawler signs in as a seeded " +
        "manager, because manager pages now 404 for a stranger — see this " +
        "file's header. Copy .env.example to .env and run:\n" +
        "  docker compose up -d && bun run db:migrate && bun run db:seed",
    );
    process.exit(2);
  }

  const username = process.env.CHECK_LINKS_USER ?? "lan.nguyen";
  const sql = connect(url);
  try {
    const { token } = await signIn(sql, {
      username,
      password: process.env.CHECK_LINKS_PASSWORD ?? SEED_DEV_PASSWORD,
      clock: systemClock,
    });
    return token;
  } catch (e) {
    console.error(
      `Could not sign in as ${JSON.stringify(username)}: ${e.message ?? e}\n` +
        "The crawler needs the seeded database (bun run db:migrate && bun run " +
        "db:seed). Note that `db:seed` does not overwrite an existing user's " +
        "password_hash, so a database seeded before that hash was real needs " +
        "to be rebuilt rather than re-seeded.",
    );
    process.exit(2);
  } finally {
    await sql.end();
  }
}

const token = await signInForCrawl();

async function get(path) {
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    return { status: res.status, html: res.ok ? await res.text() : "" };
  } catch (e) {
    return { status: 0, html: "", error: String(e.message ?? e) };
  }
}

const probe = await get("/");
if (probe.status === 0) {
  console.error(`Cannot reach ${BASE} — start the dev server first (bun run dev).`);
  process.exit(2);
}

const targets = new Map(); // path -> Set of pages linking to it
const seedBad = [];

for (const seed of SEEDS) {
  const { status, html } = await get(seed);
  if (status !== 200) {
    seedBad.push({ seed, status });
    continue;
  }
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const path = m[1].replace(/\/$/, "") || "/";
    if (path.startsWith("/_next")) continue;
    if (!targets.has(path)) targets.set(path, new Set());
    targets.get(path).add(seed);
  }
}

const dead = [];
for (const [path, from] of targets) {
  const { status } = await get(path);
  if (status !== 200) dead.push({ path, status, from: [...from] });
}

console.log(
  `${SEEDS.length} pages rendered, ${targets.size} distinct link targets checked\n`,
);

if (seedBad.length) {
  console.log("SEED PAGES THAT DID NOT RENDER:");
  for (const s of seedBad) console.log(`  ${s.status}  ${s.seed}`);
  console.log();
}

if (dead.length === 0 && seedBad.length === 0) {
  console.log("every internal link resolves");
  process.exit(0);
}

if (dead.length) {
  console.log("DEAD LINKS:");
  for (const d of dead) {
    console.log(`  ${d.status}  ${d.path}`);
    for (const f of d.from) console.log(`         linked from ${f}`);
  }
}
process.exit(1);
