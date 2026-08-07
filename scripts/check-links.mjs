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
 *   bun run dev              # in another terminal
 *   bun run check:links
 */
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

async function get(path) {
  try {
    const res = await fetch(BASE + path, { redirect: "manual" });
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
