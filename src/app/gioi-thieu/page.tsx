import { MarketingFooter, MarketingHeader } from "@/components/shell/public-header";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Giới thiệu — OLibra" };

export default function AboutPage() {
  return (
    <>
      <MarketingHeader active="gioi-thieu" />

      <main className="mx-auto max-w-[680px] px-6 py-12 md:py-16">
        <h1 className="text-[28px] leading-tight font-semibold">Giới thiệu</h1>
        <p className="mt-4 text-[18px] leading-[1.7] text-ink/90">
          OLibra là phần mềm quản lý cho những tủ sách nhỏ trong giáo xứ — nơi vài
          trăm cuốn sách được các bạn tình nguyện viên trông coi.
        </p>

        <article className="mt-12 space-y-12">
          <section>
            <h2 className="text-xl font-semibold">Vì sao có OLibra</h2>
            <div className="mt-4 space-y-5 text-[16px] leading-[1.8]">
              <p>
                Một tủ sách giáo xứ nhỏ, chỉ vài trăm cuốn, không phải là một thư
                viện công cộng. Không có nhân viên trực quầy, không có hệ thống mã
                vạch, và phần lớn phần mềm quản lý thư viện trên thị trường được
                viết cho một chỗ lớn hơn thế rất nhiều.
              </p>
              <p>
                Người trông coi tủ sách thường là một bạn tình nguyện viên, đứng
                ngay bên kệ sách, một tay cầm điện thoại, một tay cầm cuốn sách vừa
                được trả lại. OLibra được viết cho đúng khoảnh khắc đó — không phải
                cho một thủ thư ngồi sau bàn làm việc, mà cho người đang đứng, đang
                thao tác nhanh, và cần một câu trả lời rõ ràng ngay trên màn hình
                nhỏ.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold">OLibra hoạt động thế nào</h2>
            <ol className="mt-4 space-y-5 text-[16px] leading-[1.8]">
              <li>
                <span className="font-semibold">Cho mượn.</span> Chọn cuốn sách,
                chọn người đọc, xác nhận — chỉ vài chạm là xong, không cần điền giấy
                tờ.
              </li>
              <li>
                <span className="font-semibold">Nhận trả.</span> Tìm đúng cuốn đang
                mượn, kiểm tra xem sách còn nguyên vẹn hay đã sờn cũ, rồi đóng lại
                lượt mượn.
              </li>
              <li>
                <span className="font-semibold">Một cuốn nhật ký.</span> Mọi thao
                tác được ghi lại thành một câu tiếng Việt bình thường, kiểu "Bạn đã
                cho Giuse Trần Minh mượn Dế Mèn Phiêu Lưu Ký", để ai đọc lại cũng
                hiểu ngay, không cần biết gì về phần mềm.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Điều OLibra cố ý không làm</h2>
            <div className="mt-4 space-y-5 text-[16px] leading-[1.8]">
              <p>
                OLibra không tính phạt trễ hạn, không thu tiền, không có hoá đơn hay
                ví điện tử nào cả. Cũng không kết nối với các hệ thống thư viện lớn,
                và không có trang hồ sơ công khai nào ngoài bảng xếp hạng bạn đọc
                chăm đọc nhất trong tháng.
              </p>
              <p>
                Đó không phải là thiếu sót. Phạt tiền, hoá đơn, tích hợp hệ thống —
                những thứ đó thuộc về một loại tổ chức khác, có ngân sách, có nhân
                sự, có quy trình riêng. Một tủ sách giáo xứ vận hành bằng lòng tin
                và một cuốn sổ ghi chép, và OLibra chỉ cố làm tốt đúng việc đó.
              </p>
            </div>
          </section>
        </article>

        <div className="mt-14">
          <ButtonLink href="/tu-sach" variant="primary" size="lg">
            Xem các tủ sách
          </ButtonLink>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
