/**
 * Renders every screen of the running app into a single PDF for a client
 * proposal.
 *
 * Every page is a normal 1440x900 desktop screen. A screen taller than the
 * viewport simply continues onto the next page, so nothing is cropped and
 * nothing is squashed into an odd tall page. Title and section pages are
 * rendered from HTML through the same browser, so Vietnamese diacritics come
 * out right without embedding a font by hand.
 *
 *   bun run scripts/export-pdf.mjs            desktop only
 *   bun run scripts/export-pdf.mjs --mobile   also append a 375px section
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

const BASE = "http://localhost:3000";
const OUT_DIR = ".artifacts/proposal";
const WIDTH = 1440;
const HEIGHT = 900;
const MOBILE_WIDTH = 390;
const S = "/tu-sach/dong-thap";

const SECTIONS = [
  {
    title: "Trang giới thiệu",
    blurb: "Trang công khai giới thiệu OLibra và cổng vào các tủ sách.",
    routes: [
      ["/", "Trang chủ"],
      ["/gioi-thieu", "Giới thiệu"],
      ["/lien-he", "Liên hệ"],
      ["/bai-viet", "Bài viết"],
      ["/bai-viet/cach-sap-xep-mot-tu-sach-giao-xu", "Chi tiết bài viết"],
      ["/tu-sach", "Cổng tủ sách"],
    ],
  },
  {
    title: "Trang tủ sách — dành cho bạn đọc",
    blurb:
      "Những gì một em nhỏ hoặc phụ huynh nhìn thấy: sách đang có, cách xin mượn.",
    routes: [
      [S, "Trang tủ sách"],
      [`${S}/danh-muc`, "Danh mục sách"],
      [`${S}/sach/de-men-phieu-luu-ky`, "Chi tiết sách — còn sách"],
      [`${S}/sach/hoang-tu-be`, "Chi tiết sách — đang mượn"],
      [`${S}/sach/de-men-phieu-luu-ky/xin-muon`, "Xin mượn (khách)"],
      [`${S}/tim-kiem?q=de+men`, "Tìm kiếm"],
      [`${S}/thong-bao`, "Thông báo"],
      [`${S}/gop-y`, "Gửi góp ý"],
      ["/dang-nhap", "Đăng nhập"],
      ["/dang-ky", "Đăng ký bạn đọc"],
    ],
  },
  {
    title: "Trang của bạn đọc",
    blurb: "Sau khi đăng nhập: sách đang mượn, lịch sử, hồ sơ, thông báo.",
    routes: [
      [`${S}/toi`, "Trang của tôi"],
      [`${S}/toi/lich-su`, "Lịch sử mượn"],
      [`${S}/toi/ho-so`, "Hồ sơ"],
      [`${S}/toi/thong-bao`, "Thông báo"],
    ],
  },
  {
    title: "Trang quản lý",
    blurb:
      "Nơi tình nguyện viên làm việc: cho mượn ba bước, nhận trả, duyệt bạn đọc.",
    routes: [
      [`${S}/quan-ly`, "Trang chính"],
      [`${S}/quan-ly/cho-muon`, "Cho mượn · bước 1/3"],
      [`${S}/quan-ly/cho-muon/nguoi-doc`, "Cho mượn · bước 2/3"],
      [`${S}/quan-ly/cho-muon/xac-nhan`, "Cho mượn · bước 3/3"],
      [`${S}/quan-ly/nhan-tra`, "Nhận trả"],
      [`${S}/quan-ly/qua-han`, "Quá hạn"],
      [`${S}/quan-ly/dang-ky-cho-duyet`, "Đăng ký chờ duyệt"],
      [`${S}/quan-ly/yeu-cau-muon`, "Yêu cầu mượn"],
      [`${S}/quan-ly/binh-luan`, "Bình luận chờ duyệt"],
      [`${S}/quan-ly/sach`, "Danh sách sách"],
      [`${S}/quan-ly/sach/moi`, "Thêm sách"],
      [`${S}/quan-ly/sach/de-men-phieu-luu-ky`, "Chi tiết sách (quản lý)"],
      [`${S}/quan-ly/nguoi-doc`, "Danh sách bạn đọc"],
      [`${S}/quan-ly/nguoi-doc/minh`, "Hồ sơ bạn đọc"],
      [`${S}/quan-ly/thong-ke`, "Thống kê"],
      [`${S}/quan-ly/thong-bao`, "Thông báo"],
      [`${S}/quan-ly/cai-dat`, "Cài đặt"],
    ],
  },
  {
    title: "Trang quản trị hệ thống",
    blurb: "Giám sát nhiều tủ sách, quản lý viên và nhật ký hoạt động.",
    routes: [
      ["/quan-tri", "Tổng quan"],
      ["/quan-tri/tu-sach", "Cài đặt tủ sách"],
      ["/quan-tri/quan-ly-vien", "Quản lý viên"],
      ["/quan-tri/quan-ly-vien/lan", "Hoạt động của quản lý viên"],
      ["/quan-tri/nhat-ky", "Nhật ký"],
      ["/quan-tri/gop-y", "Hộp thư góp ý"],
      ["/quan-tri/bai-viet", "Bài viết"],
      ["/quan-tri/cai-dat", "Cài đặt hệ thống"],
    ],
  },
  {
    title: "Trang lỗi",
    blurb: "Khi có sự cố, người dùng vẫn được giải thích bằng tiếng Việt rõ ràng.",
    routes: [
      ["/khong-ton-tai", "Không tìm thấy trang (404)"],
      ["/loi", "Các trạng thái lỗi khác"],
    ],
  },
];

const MOBILE_ROUTES = [
  [S, "Trang tủ sách"],
  [`${S}/danh-muc`, "Danh mục"],
  [`${S}/sach/de-men-phieu-luu-ky`, "Chi tiết sách"],
  [`${S}/quan-ly`, "Trang chính (quản lý)"],
  [`${S}/quan-ly/cho-muon`, "Cho mượn"],
  [`${S}/quan-ly/nhan-tra`, "Nhận trả"],
  [`${S}/toi`, "Trang của tôi"],
];

const shell = (body, w) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;600&family=Literata:wght@600&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${w}px;background:#FBF9F6;color:#3A352F;
       font-family:Lexend,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
</style></head><body>${body}</body></html>`;

const titlePage = (w) =>
  shell(
    `<div style="height:${HEIGHT}px;display:flex;flex-direction:column;justify-content:center;padding:0 96px">
      <div style="width:64px;height:3px;background:#A4673B;margin-bottom:40px"></div>
      <h1 style="font-size:64px;font-weight:600;letter-spacing:-.02em;line-height:1.1">OLibra</h1>
      <p style="font-family:Literata,Georgia,serif;font-size:30px;margin-top:16px;color:#776857">Hệ thống quản lý tủ sách cộng đồng</p>
      <p style="font-size:19px;line-height:1.7;margin-top:40px;max-width:720px;color:#716962">
        Bản thiết kế giao diện đầy đủ. Phần mềm dành cho những tủ sách nhỏ trong giáo xứ,
        nơi vài trăm cuốn sách được các bạn tình nguyện viên trông coi — và người dùng
        chính là các em nhỏ.
      </p>
      <p style="font-size:16px;margin-top:64px;color:#8A8077">Tủ sách Đồng Tháp · bản mẫu giao diện</p>
    </div>`,
    w,
  );

const sectionPage = (n, title, blurb, w) =>
  shell(
    `<div style="height:${HEIGHT}px;display:flex;flex-direction:column;justify-content:center;padding:0 96px;background:#F2EBE1">
      <p style="font-size:17px;color:#776857;letter-spacing:.08em">Phần ${n}</p>
      <h2 style="font-size:44px;font-weight:600;margin-top:12px">${title}</h2>
      <p style="font-size:19px;line-height:1.7;margin-top:14px;max-width:760px;color:#716962">${blurb}</p>
    </div>`,
    w,
  );

async function renderHtml(page, html, width) {
  await page.setViewport({ width, height: 800, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  return page.pdf({
    width: `${width}px`,
    height: `${HEIGHT}px`,
    printBackground: true,
  });
}

async function renderRoute(page, url, width) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  // The manager shell clips its own scroll; unclip it so the whole screen prints.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === "auto" || cs.overflowY === "hidden") {
        el.style.overflow = "visible";
      }
      if (cs.height === "100vh" || cs.maxHeight === "100vh") el.style.height = "auto";
    }
    document.documentElement.style.height = "auto";
    document.body.style.height = "auto";
  });
  // Discourage a page break through the middle of a card or a table row.
  await page.addStyleTag({
    content: `[class*="rounded-card"], tr, li, dl > div { break-inside: avoid; }`,
  });
  await new Promise((r) => setTimeout(r, 350));
  return page.pdf({
    width: `${width}px`,
    height: `${HEIGHT}px`,
    printBackground: true,
  });
}

const wantMobile = process.argv.includes("--mobile");

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const parts = [];
let n = 0;

parts.push(await renderHtml(page, titlePage(WIDTH), WIDTH));

for (const section of SECTIONS) {
  n += 1;
  parts.push(await renderHtml(page, sectionPage(n, section.title, section.blurb, WIDTH), WIDTH));
  for (const [route, label] of section.routes) {
    process.stdout.write(`  ${label} … `);
    try {
      parts.push(await renderRoute(page, BASE + route, WIDTH));
      console.log("ok");
    } catch (e) {
      console.log("FAILED:", e.message.split("\n")[0]);
    }
  }
}

if (wantMobile) {
  n += 1;
  parts.push(
    await renderHtml(
      page,
      sectionPage(n, "Trên điện thoại", "Tình nguyện viên đứng ngay tại kệ sách, chỉ có một chiếc điện thoại trên tay.", WIDTH),
      WIDTH,
    ),
  );
  for (const [route, label] of MOBILE_ROUTES) {
    process.stdout.write(`  [mobile] ${label} … `);
    try {
      parts.push(await renderRoute(page, BASE + route, MOBILE_WIDTH));
      console.log("ok");
    } catch (e) {
      console.log("FAILED:", e.message.split("\n")[0]);
    }
  }
}

await browser.close();

const out = await PDFDocument.create();
out.setTitle("OLibra — Bản thiết kế giao diện");
out.setSubject("Hệ thống quản lý tủ sách cộng đồng");
for (const bytes of parts) {
  const src = await PDFDocument.load(bytes);
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach((p) => out.addPage(p));
}
const file = join(OUT_DIR, "OLibra-thiet-ke-giao-dien.pdf");
await writeFile(file, await out.save());
const { size } = await import("node:fs").then((fs) => fs.promises.stat(file));
console.log(`\n${out.getPageCount()} trang → ${file} (${(size / 1e6).toFixed(1)} MB)`);
