/**
 * Renders every screen of the running app into a single PDF for a client
 * proposal.
 *
 * One screen per page. Each page carries a heading and a one-line purpose,
 * with the full screenshot below it scaled to fit — so a long screen is shown
 * whole, just smaller, rather than cropped or spilling onto a second page.
 *
 * Screens are captured to PNG first, then laid out in one HTML document that
 * is printed in a single pass. Doing it that way keeps the headings as real
 * text in the PDF, and Vietnamese diacritics come out right without embedding
 * a font by hand.
 *
 *   bun run scripts/export-pdf.mjs            desktop only
 *   bun run scripts/export-pdf.mjs --mobile   also append a 375px section
 */
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer";

const BASE = "http://localhost:3000";
const OUT_DIR = ".artifacts/proposal";
const SHOTS = join(OUT_DIR, "shots");
const WIDTH = 1440;
const HEIGHT = 900;
const MOBILE_WIDTH = 390;
const S = "/tu-sach/dong-thap";

/** Each route is [path, title, purpose]. */
const SECTIONS = [
  {
    title: "Trang giới thiệu",
    blurb: "Trang công khai giới thiệu OLibra và cổng vào các tủ sách.",
    routes: [
      ["/", "Trang chủ", "Giới thiệu OLibra trong một câu, và lối vào cổng tủ sách."],
      ["/gioi-thieu", "Giới thiệu", "Vì sao có OLibra, cách hoạt động, và những điều cố ý không làm."],
      ["/lien-he", "Liên hệ", "Thông tin ban quản trị và biểu mẫu liên hệ."],
      ["/bai-viet", "Bài viết", "Kinh nghiệm mở và giữ một tủ sách nhỏ trong giáo xứ."],
      ["/bai-viet/cach-sap-xep-mot-tu-sach-giao-xu", "Chi tiết bài viết", "Cột chữ hẹp cho dễ đọc; tựa sách dùng kiểu chữ có chân."],
      ["/tu-sach", "Cổng tủ sách", "Danh bạ các tủ sách: địa điểm, giờ mở, người giữ chìa khoá."],
    ],
  },
  {
    title: "Trang tủ sách — dành cho bạn đọc",
    blurb: "Những gì một em nhỏ hoặc phụ huynh nhìn thấy: sách đang có và cách xin mượn.",
    routes: [
      [S, "Trang tủ sách", "Nhận diện tủ sách trước tiên: ở đâu, mở khi nào, gọi ai."],
      [`${S}/danh-muc`, "Danh mục sách", "Lưới bìa sách; chuyển đang có / toàn bộ bằng nút gạt."],
      [`${S}/sach/de-men-phieu-luu-ky`, "Chi tiết sách — còn sách", "Bảng xanh, số bản còn, một nút lớn: Xin mượn."],
      [`${S}/sach/hoang-tu-be`, "Chi tiết sách — đang mượn", "Bảng hổ phách nêu ai đang giữ, còn mấy ngày, mấy người chờ."],
      [`${S}/sach/de-men-phieu-luu-ky/xin-muon`, "Xin mượn (khách)", "Khách chưa có tài khoản để lại tên và số điện thoại."],
      [`${S}/tim-kiem?q=de+men`, "Tìm kiếm", "Không cần gõ dấu — 'de men' vẫn ra 'Dế Mèn'."],
      [`${S}/thong-bao`, "Thông báo", "Tin ghim hiện đầu trang, các tin còn lại xếp dưới."],
      [`${S}/gop-y`, "Gửi góp ý", "Biểu mẫu một cột; trường bắt buộc ghi rõ bằng chữ."],
      ["/dang-nhap", "Đăng nhập", "Kèm trạng thái báo lỗi; quên mật khẩu thì nhắn quản lý."],
      ["/dang-ky", "Đăng ký bạn đọc", "Một trang duy nhất; mỗi trường đều giải thích vì sao cần."],
    ],
  },
  {
    title: "Trang của bạn đọc",
    blurb: "Sau khi đăng nhập: sách đang mượn, lịch sử, hồ sơ và thông báo.",
    routes: [
      [`${S}/toi`, "Trang của tôi", "Sách đang giữ, số ngày còn lại; cuốn quá hạn không gia hạn được."],
      [`${S}/toi/lich-su`, "Lịch sử mượn", "Xếp theo tháng, kèm tình trạng sách khi trả."],
      [`${S}/toi/ho-so`, "Hồ sơ", "Tổ và giáo họ chỉ đọc — phải nhờ quản lý đổi."],
      [`${S}/toi/thong-bao`, "Thông báo", "Chỉ báo trong ứng dụng; hệ thống không gửi email."],
    ],
  },
  {
    title: "Trang quản lý",
    blurb: "Nơi tình nguyện viên làm việc: cho mượn ba bước, nhận trả, duyệt bạn đọc.",
    routes: [
      [`${S}/quan-ly`, "Trang chính", "Bốn thẻ cần xử lý, rồi hai nút lớn: Cho mượn và Nhận trả."],
      [`${S}/quan-ly/cho-muon`, "Cho mượn · bước 1/3", "Tìm sách; ô tìm kiếm là thứ nổi bật nhất màn hình."],
      [`${S}/quan-ly/cho-muon/nguoi-doc`, "Cho mượn · bước 2/3", "Bạn đọc không mượn được vẫn hiện, kèm lý do rõ ràng."],
      [`${S}/quan-ly/cho-muon/xac-nhan`, "Cho mượn · bước 3/3", "Hạn trả ghi thành ngày, không phải giờ phút."],
      [`${S}/quan-ly/nhan-tra`, "Nhận trả", "Sáu nút tình trạng, 'Nguyên vẹn' chọn sẵn — ca thường gặp chỉ một chạm."],
      [`${S}/quan-ly/qua-han`, "Quá hạn", "Số điện thoại là nút gọi — cách sách quay về nhanh nhất."],
      [`${S}/quan-ly/dang-ky-cho-duyet`, "Đăng ký chờ duyệt", "Có cảnh báo trùng tên để bắt đăng ký lặp."],
      [`${S}/quan-ly/yeu-cau-muon`, "Yêu cầu mượn", "Xếp theo sách và thứ tự đăng ký; giữ chỗ do quản lý quyết định."],
      [`${S}/quan-ly/binh-luan`, "Bình luận chờ duyệt", "Bình luận chỉ hiện công khai sau khi được duyệt."],
      [`${S}/quan-ly/sach`, "Danh sách sách", "Bảng trên máy tính, thẻ xếp dọc trên điện thoại."],
      [`${S}/quan-ly/sach/moi`, "Thêm sách", "Ảnh bìa trước tiên; hệ thống tự sinh mã cho từng bản."],
      [`${S}/quan-ly/sach/de-men-phieu-luu-ky`, "Chi tiết sách (quản lý)", "Từng bản sách, lịch sử đánh giá tình trạng và lịch sử mượn."],
      [`${S}/quan-ly/nguoi-doc`, "Danh sách bạn đọc", "Lọc theo trạng thái bằng thẻ, không dùng danh sách xổ."],
      [`${S}/quan-ly/nguoi-doc/minh`, "Hồ sơ bạn đọc", "Có trường chỉ quản lý thấy; tạm khoá không ảnh hưởng sách đang mượn."],
      [`${S}/quan-ly/thong-ke`, "Thống kê", "Chỉ biểu đồ cột và đường; mỗi biểu đồ có câu tóm tắt phía trên."],
      [`${S}/quan-ly/thong-bao`, "Thông báo", "Viết, ghim, đăng và cho hết hạn thông báo của tủ sách."],
      [`${S}/quan-ly/cai-dat`, "Cài đặt", "Quy định cho mượn chỉ đọc, kèm nút xuất dữ liệu CSV."],
    ],
  },
  {
    title: "Trang quản trị hệ thống",
    blurb: "Giám sát nhiều tủ sách, quản lý viên và nhật ký hoạt động.",
    routes: [
      ["/quan-tri", "Tổng quan", "Mỗi tủ sách một dòng; việc cần chú ý viết thành câu tiếng Việt."],
      ["/quan-tri/tu-sach", "Cài đặt tủ sách", "Đường dẫn khoá sau khi tạo, vì đã nằm trong link đã chia sẻ."],
      ["/quan-tri/quan-ly-vien", "Quản lý viên", "Thu hồi quyền đổi vai trò, không bao giờ xoá người."],
      ["/quan-tri/quan-ly-vien/lan", "Hoạt động của quản lý viên", "Trả lời câu hỏi: quản lý này đã làm những gì."],
      ["/quan-tri/nhat-ky", "Nhật ký", "Mỗi dòng là một câu tiếng Việt; giá trị gốc chỉ hiện khi mở rộng."],
      ["/quan-tri/gop-y", "Hộp thư góp ý", "Trả lời bằng cách gọi điện, vì hệ thống không gửi email."],
      ["/quan-tri/bai-viet", "Bài viết", "Quản lý bài viết chung của toàn hệ thống."],
      ["/quan-tri/cai-dat", "Cài đặt hệ thống", "Mặc định cho tủ sách mới, ngôn ngữ và múi giờ."],
    ],
  },
  {
    title: "Trang lỗi",
    blurb: "Khi có sự cố, người dùng vẫn được giải thích bằng tiếng Việt rõ ràng.",
    routes: [
      ["/khong-ton-tai", "Không tìm thấy trang (404)", "Giọng nhẹ nhàng; biểu tượng màu xám ấm chứ không phải đỏ."],
      ["/loi", "Các trạng thái lỗi khác", "403, hết phiên đăng nhập, quá nhiều yêu cầu, lỗi máy chủ."],
    ],
  },
];

const MOBILE = {
  title: "Trên điện thoại",
  blurb: "Tình nguyện viên đứng ngay tại kệ sách, chỉ có một chiếc điện thoại trên tay.",
  routes: [
    [S, "Trang tủ sách", "Nhận diện tủ sách và hai nút lớn."],
    [`${S}/danh-muc`, "Danh mục", "Hai cột bìa sách trên điện thoại."],
    [`${S}/sach/de-men-phieu-luu-ky`, "Chi tiết sách", "Tựa sách và nút mượn lên trước, thông tin tra cứu xuống cuối."],
    [`${S}/quan-ly`, "Trang chính (quản lý)", "Bốn thẻ 2×2 và hai nút lớn cỡ ngón tay cái."],
    [`${S}/quan-ly/cho-muon`, "Cho mượn", "Kết quả xếp dọc; tựa sách không bị cắt."],
    [`${S}/quan-ly/nhan-tra`, "Nhận trả", "Sáu nút tình trạng xếp lưới 3×2."],
    [`${S}/toi`, "Trang của tôi", "Thẻ sách nằm ngang, hạn trả thấy ngay."],
  ],
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function capture(page, url, width, file) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await Promise.race([
    page.evaluate(() => document.fonts.ready),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  // The manager shell clips its own scroll; unclip it or only the first
  // screenful would be captured.
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
  // Strip Next's dev overlay — it renders a floating badge that has no place
  // in a document going to a client.
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: file, fullPage: true, type: "png" });
}

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const sections = [...SECTIONS];
if (process.argv.includes("--mobile")) sections.push(MOBILE);

const blocks = [];
let pageNo = 0;
let shot = 0;

for (const [i, section] of sections.entries()) {
  blocks.push(`<section class="divider">
    <p class="eyebrow">Phần ${i + 1}</p>
    <h2>${esc(section.title)}</h2>
    <p class="blurb">${esc(section.blurb)}</p>
  </section>`);

  const isMobile = section === MOBILE;
  for (const [route, title, purpose] of section.routes) {
    shot += 1;
    const name = `${String(shot).padStart(2, "0")}.png`;
    process.stdout.write(`  ${title} … `);
    try {
      await capture(page, BASE + route, isMobile ? MOBILE_WIDTH : WIDTH, join(SHOTS, name));
      pageNo += 1;
      blocks.push(`<section class="screen">
        <header>
          <h3><span class="no">Trang ${pageNo}</span> · ${esc(title)}</h3>
          <p class="purpose">${esc(purpose)}</p>
        </header>
        <div class="shot${isMobile ? " phone" : ""}"><img src="./shots/${name}" alt=""></div>
      </section>`);
      console.log("ok");
    } catch (e) {
      console.log("FAILED:", e.message.split("\n")[0]);
    }
  }
}

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<style>
  @page { size: ${WIDTH}px ${HEIGHT}px; margin: 0; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#FBF9F6;color:#3A352F;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  section{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;break-after:page;position:relative}
  section:last-child{break-after:auto}

  .cover{display:flex;flex-direction:column;justify-content:center;padding:0 96px}
  .cover .rule{width:64px;height:3px;background:#A4673B;margin-bottom:40px}
  .cover h1{font-size:64px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
  .cover .sub{font-size:30px;margin-top:16px;color:#776857}
  .cover .lead{font-size:19px;line-height:1.7;margin-top:40px;max-width:720px;color:#716962}
  .cover .foot{font-size:16px;margin-top:64px;color:#8A8077}

  .divider{display:flex;flex-direction:column;justify-content:center;padding:0 96px;background:#F2EBE1}
  .divider .eyebrow{font-size:17px;color:#776857;letter-spacing:.08em}
  .divider h2{font-size:44px;font-weight:600;margin-top:12px}
  .divider .blurb{font-size:19px;line-height:1.7;margin-top:14px;max-width:760px;color:#716962}

  .screen{display:flex;flex-direction:column;padding:36px 56px 40px}
  .screen header{flex:0 0 auto;margin-bottom:18px}
  .screen h3{font-size:25px;font-weight:600;line-height:1.3}
  .screen h3 .no{color:#A4673B}
  .screen .purpose{font-size:16px;color:#716962;margin-top:5px}
  .shot{flex:1 1 auto;min-height:0;display:flex;align-items:flex-start;justify-content:center}
  .shot img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;
            border:1px solid #D3CBC2;border-radius:6px}
  .shot.phone img{max-width:290px}
</style></head><body>
<section class="cover">
  <div class="rule"></div>
  <h1>OLibra</h1>
  <p class="sub">Hệ thống quản lý tủ sách cộng đồng</p>
  <p class="lead">Bản thiết kế giao diện đầy đủ. Phần mềm dành cho những tủ sách nhỏ
    trong giáo xứ, nơi vài trăm cuốn sách được các bạn tình nguyện viên trông coi —
    và người dùng chính là các em nhỏ.</p>
  <p class="foot">Tủ sách Đồng Tháp · bản mẫu giao diện · ${pageNo} màn hình</p>
</section>
${blocks.join("\n")}
</body></html>`;

const indexPath = join(OUT_DIR, "index.html");
await writeFile(indexPath, html);

await page.setViewport({ width: WIDTH, height: HEIGHT });
await page.goto("file://" + resolve(indexPath), { waitUntil: "load", timeout: 180000 });
await new Promise((r) => setTimeout(r, 2000));

const file = join(OUT_DIR, "OLibra-thiet-ke-giao-dien.pdf");
await page.pdf({
  path: file,
  width: `${WIDTH}px`,
  height: `${HEIGHT}px`,
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();

const { size } = await stat(file);
console.log(`\n${pageNo} màn hình → ${file} (${(size / 1e6).toFixed(1)} MB)`);
