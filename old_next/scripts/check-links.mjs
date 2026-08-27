/**
 * Crawls the running app and reports internal links that 404, pages that fault,
 * and query-string states that fault.
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
 * **Two passes, and both are load-bearing.**
 *
 * *Signed in*, because as of U1 it has to be. This used to be an anonymous
 * crawler, because every page rendered from `src/lib/fixtures.ts` and a
 * stranger could see all forty-seven of them. `quan-ly/cho-muon` is now a real
 * database read behind `requireManager`, and U1 §3.4's answer for a caller who
 * may not see a manager screen is `notFound()` — so an anonymous crawl gets a
 * perfectly correct 404 and reports it as a dead link. That pass is where dead
 * links are found, because a signed-in manager sees strictly more of the app
 * than anyone else.
 *
 * *Anonymously*, because making the crawler sign in silently dropped the check
 * every page used to get as a stranger — including `/`, `/tu-sach`,
 * `/dang-nhap` and `/dang-ky`, which have no manager in them at all. What that
 * pass asserts is narrower and deliberately so: **nothing may fault.** It
 * cannot assert 200, since a manager URL answering 404 to a stranger is the
 * correct outcome and the whole point of U1 §3.4. A 5xx is never correct for
 * anybody, and it is exactly what the two shipped query-string defects
 * produced.
 *
 * **It crawls query strings, and as of U1 it has to.** The href pattern used to
 * be `href="(\/[^"#?]*)`, which cut every URL at its `?`. Query parameters are
 * now the entire state model of the six lending screens — `?sach=`,
 * `?nguoi-doc=`, `?q=`, `?muon=`, `?loi=` — so the crawler was checking the six
 * routes and none of the states, and both of the 500s U1 shipped were
 * invisible to it.
 *
 * `HOSTILE` below is the other half of that. No href this app emits carries
 * `?loi=constructor` or a repeated `?q=`, so following links can never reach
 * them; they are the shapes an address bar produces, and they are seeded by
 * hand for the same reason the routes are. With both halves in place,
 * reinstating either shipped defect turns nineteen of these URLs red.
 *
 * **And it now actually crawls.** It used to take one hop: collect links from
 * the seeds, check their status, stop. See `crawl` for what that missed — the
 * deep states of the return flow are two links from any seed, and a fault
 * planted on one of them was reported as "every internal link resolves".
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
  `${S}/sach/de-men-phieu-luu-ky`,
  `${S}/ho-so/tong-quan`,
  `${S}/ho-so/lich-su`,
  `${S}/ho-so/tang-sach`,
  `${S}/ho-so`,
  `${S}/ho-so/thong-bao`,
  `${S}/quan-ly`,
  `${S}/quan-ly/cho-muon`,
  `${S}/quan-ly/cho-muon/nguoi-doc`,
  `${S}/quan-ly/cho-muon/xac-nhan`,
  `${S}/quan-ly/nhan-tra`,
  `${S}/quan-ly/nhan-tra/bao-mat`,
  // The lending screens' *populated* states, which is where their forms are.
  // Without a `?q=` these five render a search box and nothing else — no
  // results, no rows, no confirm button — so the empty seeds above exercise
  // about a third of each page. Seeded against `db:seed`'s own data, and the
  // links they emit carry real ids, so `?muon=` and `?nguoi-doc=` states get
  // crawled by following rather than by being guessed at here.
  `${S}/quan-ly/cho-muon?q=de`,
  // "ha" rather than "minh": Giuse Trần Minh is at the loan limit in the seed,
  // so his row is a blocking sentence with no link on it, and step 3 would
  // never be reached by following. Anna Phạm Thu Hà is lendable, so the link
  // this page emits carries a real `?nguoi-doc=` and the crawler walks into
  // the confirm screen — which is where the only form on the flow lives.
  `${S}/quan-ly/cho-muon/nguoi-doc?sach=de-men-phieu-luu-ky&q=ha`,
  `${S}/quan-ly/nhan-tra?q=de`,
  `${S}/quan-ly/nhan-tra/bao-mat?q=de`,
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
  // `${S}/quan-ly/nguoi-doc/minh` was here, and it was a fixture-era id
  // (`readers[].id` in `src/lib/fixtures.ts`). U3 wave 2 wired that page to
  // `GetReaderDetail`, whose `membershipId` is a `uuid` — so this seed became a
  // failed cast and a raw `22P02`, which is how it was found. The page now
  // refuses the shape and answers 404, and a 404 cannot be a *seed*: the rule
  // for these is "must render", and `HOSTILE` below is for a volunteer's own
  // query parameters, where the page exists and 200 is the right answer.
  //
  // Nothing is lost by removing it. `${S}/quan-ly/nguoi-doc` links to every
  // reader it lists, so the crawler walks into real detail pages by following
  // rather than by this file guessing an id — which is the same reasoning the
  // lending seeds above give for reaching `?nguoi-doc=` and `?muon=` by
  // following.
  `${S}/quan-ly/thong-ke`,
  `${S}/quan-ly/thong-ke?ky=tuan`,
  `${S}/quan-ly/thong-ke?ky=tu-dau`,
  `${S}/quan-ly/thong-bao`,
  `${S}/quan-ly/cai-dat`,
  "/quan-tri",
  "/quan-tri/tu-sach",
  "/quan-tri/quan-ly-vien",
  "/quan-tri/nhat-ky",
  "/quan-tri/gop-y",
  "/quan-tri/cai-dat",
];

/**
 * Query strings no link in this app produces, and every one of which a person
 * can type.
 *
 * The six lending screens keep their whole state in the URL, so these *are*
 * their inputs — a parameter is not evidence, and the shapes below are the ones
 * that have actually broken the app rather than a list of theoretical abuse.
 *
 * - A repeated key arrives as `string[]`, and `q.trim()` inside a query was a
 *   `TypeError` on all four searching screens.
 * - `?loi=` was membership-tested with `in`, so every name inherited from
 *   `Object.prototype` resolved to a function and React refused to render it.
 * - A malformed uuid and a slug naming nothing must be empty states, not casts
 *   that reach Postgres.
 *
 * These must answer 200. A 404 here would be wrong too — the page exists and
 * the parameter is the volunteer's, not the router's.
 */
const HOSTILE = [
  `${S}/quan-ly/cho-muon?q=de&q=men`,
  `${S}/quan-ly/cho-muon/nguoi-doc?q=de&q=men`,
  `${S}/quan-ly/cho-muon/nguoi-doc?sach=de-men-phieu-luu-ky&sach=hoang-tu-be`,
  `${S}/quan-ly/cho-muon/nguoi-doc?sach=khong-co-sach-nay`,
  `${S}/quan-ly/nhan-tra?q=de&q=men`,
  `${S}/quan-ly/nhan-tra/bao-mat?q=de&q=men`,
  `${S}/quan-ly/cho-muon/xac-nhan?nguoi-doc=khong-phai-uuid`,
  `${S}/quan-ly/cho-muon/xac-nhan?sach=de-men-phieu-luu-ky&nguoi-doc=00000000-0000-4000-8000-000000000000`,
  `${S}/quan-ly/nhan-tra?muon=khong-phai-uuid`,
  `${S}/quan-ly/nhan-tra/bao-mat?muon=00000000-0000-4000-8000-000000000000`,
  // Every name an ordinary object inherits, on each of the three screens that
  // read `?loi=`. All eight passed `in` and all eight were a 500.
  ...["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"].flatMap(
    (key) => [
      `${S}/quan-ly/cho-muon/xac-nhan?loi=${key}`,
      `${S}/quan-ly/nhan-tra?loi=${key}`,
      `${S}/quan-ly/nhan-tra/bao-mat?loi=${key}`,
    ],
  ),
  `${S}/quan-ly/cho-muon/xac-nhan?loi=khong-co-ma-nay`,
];

/**
 * A real session for a real seeded manager.
 *
 * Connects with `MIGRATION_DATABASE_URL` — the superuser handle — rather than
 * `DATABASE_URL`: this is a developer tool writing a row on the caller's
 * behalf, not the application serving a request, and `signIn` inserts into
 * `sessions` directly rather than through the kernel's scoped transaction.
 *
 * **What this does and does not exercise.** It calls `signIn` — the same
 * function `signInAction` calls, against the same `sessions` table — so a
 * change to session minting, expiry or `resolveSession` breaks this too. It
 * does *not* exercise `signInAction`, the sign-in form, the `Set-Cookie` on
 * the response, or the redirect afterwards: the cookie here is assembled by
 * hand below. An earlier version of this comment claimed "a change that breaks
 * real sign-in breaks this too", which reads as covering all of that and
 * covers one function of it. `tests/auth/` is where the rest lives.
 *
 * Failures here are fatal and say why. A crawler that silently fell back to an
 * anonymous crawl would report every manager page as a dead link and blame the
 * links.
 */
async function signInForCrawl(
  username = process.env.CHECK_LINKS_USER ?? "lan.nguyen",
) {
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

/**
 * A second session, for `/quan-tri/*` only.
 *
 * B4a wired the administration surface to `loadAdminPage`, which refuses
 * everyone whose `users.is_super_admin` is false — including `lan.nguyen`, the
 * seeded *manager* the rest of this crawl uses. The seven admin pages therefore
 * answer 404 to the manager token, which is the correct answer and made the
 * crawl fail with `404 /quan-tri/gop-y` the first time it ran.
 *
 * Two tokens rather than crawling everything as the administrator: a
 * super_admin passes every role check in the application, so one admin session
 * would render all fifty pages and prove nothing about what a *manager* can
 * reach. The manager stays the default and the administrator is used for
 * exactly the prefix that needs them.
 */
const adminToken = await signInForCrawl("admin");

/** Which session a path is crawled with. `/quan-tri` is the administrator's. */
function tokenFor(path) {
  return path.startsWith("/quan-tri") ? adminToken : token;
}

/** `signedIn: false` sends no cookie at all — a stranger, not a bad session. */
async function get(path, { signedIn = true } = {}) {
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: signedIn ? { cookie: `${SESSION_COOKIE}=${tokenFor(path)}` } : {},
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

/**
 * Internal link targets in a rendered page, **query string included**.
 *
 * The fragment is still cut — `#noi-dung` names a position in the page that was
 * just fetched, not another page — but `?` is now part of the target, because
 * on six of these screens it is the whole of the state.
 */
function linksIn(html) {
  const out = [];
  for (const m of html.matchAll(/href="(\/[^"#]*)/g)) {
    const [rawPath, ...rest] = m[1].split("?");
    if (rawPath.startsWith("/_next")) continue;
    const path = rawPath.replace(/\/$/, "") || "/";
    const query = rest.join("?");
    // `&amp;` is how Next serialises `&` into an attribute. Left as-is it
    // would be sent literally and the second parameter would be named
    // `amp;nguoi-doc`, which is a request no browser ever makes.
    out.push(query ? `${path}?${query.replaceAll("&amp;", "&")}` : path);
  }
  return out;
}

/** How many URLs either pass may visit before something is clearly wrong. */
const CEILING = 2000;

/**
 * Breadth-first from the seeds, following every internal link it finds.
 *
 * **It follows discovered pages too, and that is a fix rather than a
 * refinement.** This used to collect links from the seeds and then only check
 * the *status* of what it found — one hop, never a crawl. Combined with the
 * href pattern cutting URLs at `?`, that left the deep states of the lending
 * flow unreachable by construction: `nhan-tra/bao-mat?q=…&muon=…` is only ever
 * linked from `nhan-tra?q=…&muon=…`, which is itself only ever a discovered
 * target. Measured, with a fault planted on that screen: one hop reported
 * "every internal link resolves"; the crawl below reports the 500.
 *
 * `visited` bounds it — every page's link set is finite and the flow's states
 * are a small cycle — and `CEILING` is the tripwire for the day that stops
 * being true.
 */
async function crawl(from, { signedIn }) {
  const visited = new Map(); // path -> { status, from: Set }
  const queue = [...from];
  const seen = new Set(from);

  while (queue.length) {
    if (visited.size >= CEILING) {
      console.error(
        `Stopped after ${CEILING} URLs — the link graph is either cyclic in a ` +
          "way the visited set cannot close, or a page is emitting unbounded " +
          "query strings. Neither is a link problem; fix the page.",
      );
      process.exit(2);
    }
    const path = queue.shift();
    const { status, html } = await get(path, { signedIn });
    visited.set(path, { status, from: visited.get(path)?.from ?? new Set() });
    if (status !== 200) continue;
    for (const next of linksIn(html)) {
      const record = visited.get(next);
      if (record) record.from.add(path);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
      visited.set(next, { status: null, from: new Set([path]) });
    }
  }

  return visited;
}

// ── Pass 1: signed in. Dead links, and every seed must render. ──────────────
const roots = [...SEEDS, ...HOSTILE];
const rootSet = new Set(roots);
const reached = await crawl(roots, { signedIn: true });

// ── Redirects: a URL this app published must keep working ─────────────────
/**
 * Paths that answer 3xx by design, and where each must point.
 *
 * `${S}/tang-sach` was a second donation screen until U5 replaced it with a
 * redirect to `ho-so/tang-sach`, the one the reader's own queries live behind.
 * It cannot be a *seed* — the rule for those is "must render 200" — and simply
 * deleting it from the list would stop anything checking that a URL this
 * application itself published still works.
 */
const REDIRECTS = [[`${S}/tang-sach`, `${S}/ho-so/tang-sach`]];
const REDIRECT_SOURCES = new Set(REDIRECTS.map(([from]) => from));

const seedBad = [];
const dead = [];
for (const [path, { status, from }] of reached) {
  if (status === 200) continue;
  // A path in REDIRECTS answers 3xx by design and is validated below, by
  // Location header rather than by "did it reach 200" — reporting it here
  // too would be the same fact told twice, once correctly and once as a
  // false "dead link" for a URL that is working exactly as built. PO
  // feedback round 1, Task 4 restored the shelf home's link to this path
  // (§2 of the design), which is what made the crawler reach it at all and
  // is what surfaced this double-report.
  if (REDIRECT_SOURCES.has(path)) continue;
  if (rootSet.has(path)) seedBad.push({ seed: path, status });
  else dead.push({ path, status, from: [...from] });
}

const misdirected = [];
for (const [from, to] of REDIRECTS) {
  const res = await fetch(BASE + from, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${tokenFor(from)}` },
  });
  const location = res.headers.get("location");
  const landed = location && new URL(location, BASE).pathname;
  if (res.status < 300 || res.status >= 400 || landed !== to) {
    misdirected.push({ from, to, status: res.status, landed });
  }
}

// ── Pass 2: anonymous. Nothing may fault. ──────────────────────────────────
// A 404 is expected and correct here for every manager and admin URL (U1
// §3.4), so this asserts only the absence of a fault. That is the check the
// authenticated crawler took away from all forty-seven pages, and it is what
// both of U1's shipped 500s would have tripped.
const anonymous = await crawl(roots, { signedIn: false });
const faults = [];
for (const [path, { status }] of anonymous) {
  if (status === 0 || status >= 500) faults.push({ path, status });
}

console.log(
  `${SEEDS.length} pages and ${HOSTILE.length} query states seeded, ` +
    `${reached.size} URLs crawled signed in, ` +
    `${anonymous.size} crawled anonymously\n`,
);

if (seedBad.length) {
  console.log("SEED PAGES THAT DID NOT RENDER:");
  for (const s of seedBad) console.log(`  ${s.status}  ${s.seed}`);
  console.log();
}

if (misdirected.length) {
  console.log("REDIRECTS THAT DID NOT LAND WHERE THEY SHOULD:");
  for (const m of misdirected) {
    console.log(`  ${m.status}  ${m.from} → ${m.landed ?? "(no Location)"}`);
    console.log(`         expected ${m.to}`);
  }
  console.log();
}

if (
  dead.length === 0 &&
  seedBad.length === 0 &&
  faults.length === 0 &&
  misdirected.length === 0
) {
  console.log("every internal link resolves, and nothing faults for a stranger");
  process.exit(0);
}

if (dead.length) {
  console.log("DEAD LINKS:");
  for (const d of dead) {
    console.log(`  ${d.status}  ${d.path}`);
    for (const f of d.from) console.log(`         linked from ${f}`);
  }
}

if (faults.length) {
  console.log("\nFAULTS FOR AN ANONYMOUS VISITOR (a 404 here would be fine):");
  for (const f of faults) console.log(`  ${f.status || "unreachable"}  ${f.path}`);
}
process.exit(1);
