import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BookTitle } from "@/components/ui/book";
import { MarketingFooter, MarketingHeader } from "@/components/shell/public-header";
import { posts } from "@/lib/fixtures";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

type Block =
  | { type: "p"; content: React.ReactNode }
  | { type: "h2"; content: React.ReactNode }
  | { type: "quote"; content: React.ReactNode }
  | { type: "ul"; items: React.ReactNode[] };

type Article = {
  standfirst: string;
  readMinutes: number;
  body: Block[];
};

const ARTICLES: Record<string, Article> = {
  "cach-sap-xep-mot-tu-sach-giao-xu": {
    standfirst:
      "Sau một năm chạy tủ sách Đồng Tháp, chúng tôi rút ra vài điều rất đơn giản về cách xếp sách, cách đánh mã và cách giữ cho kệ sách không rối.",
    readMinutes: 6,
    body: [
      {
        type: "p",
        content:
          "Khi tủ sách Đồng Tháp mới mở, chúng tôi xếp sách theo cách quen thuộc nhất: theo bảng chữ cái tên tác giả, giống một thư viện lớn. Nhìn thì gọn, nhưng chỉ sau vài tuần đã thấy có vấn đề — các em nhỏ không tìm được sách, còn người lớn thì loay hoay không biết nên xếp sách mới vào đâu.",
      },
      {
        type: "p",
        content:
          "Sau một năm vừa làm vừa sửa, chúng tôi rút ra vài nguyên tắc rất đơn giản, không có gì cao siêu, nhưng đủ để một tủ sách nhỏ chạy trơn tru mà không cần ai phải nhớ quá nhiều.",
      },
      {
        type: "h2",
        content: "Xếp theo lứa tuổi, không xếp theo bảng chữ cái",
      },
      {
        type: "p",
        content:
          "Điều đầu tiên chúng tôi đổi là bỏ hẳn cách xếp theo tên tác giả. Thay vào đó, kệ được chia theo lứa tuổi: một kệ thấp cho các em mới biết đọc, một kệ giữa cho các em cấp một, cấp hai, và một kệ trên cùng cho sách người lớn hoặc sách dày. Các em tự biết kệ nào là của mình, không cần hỏi ai.",
      },
      {
        type: "p",
        content: (
          <>
            Ở kệ giữa, những cuốn như <BookTitle>Dế Mèn Phiêu Lưu Ký</BookTitle> hay{" "}
            <BookTitle>Totto-chan Bên Cửa Sổ</BookTitle> luôn được đặt ngang tầm
            mắt, bìa quay ra ngoài thay vì xếp gáy sách như một tủ sách người lớn.
            Các em nhìn thấy bìa là cầm lên xem ngay, còn nếu chỉ thấy gáy sách thì
            gần như chẳng ai động tới.
          </>
        ),
      },
      {
        type: "quote",
        content: "Cái kệ nào các em tự lấy được thì cái kệ đó sống.",
      },
      {
        type: "h2",
        content: "Đánh mã cho từng bản, không phải từng đầu sách",
      },
      {
        type: "p",
        content:
          "Nhiều tủ sách chỉ đánh một mã cho một đầu sách, dù có ba bốn bản giống nhau trên kệ. Cách đó tiện lúc nhập sách nhưng lại rất khó theo dõi khi cho mượn — không biết bản nào đang ở đâu, bản nào bị rách, bản nào đã mất. Tủ sách Đồng Tháp đánh mã riêng cho từng bản, ví dụ ba bản của cùng một đầu sách sẽ có mã DT-0140, DT-0141, DT-0142.",
      },
      {
        type: "ul",
        items: [
          "Mỗi bản sách có một mã riêng, ví dụ DT-0142, không dùng chung mã cho nhiều bản giống nhau.",
          "Mã được dán ngay trên gáy sách, ở chỗ dễ thấy khi sách còn nằm trên kệ.",
          "Khi nhận trả, quản lý chỉ cần nhìn mã là biết đúng bản nào đã về, không phải đoán qua tên bạn đọc.",
        ],
      },
      {
        type: "p",
        content:
          "Không có cách xếp nào là đúng tuyệt đối, mỗi tủ sách có một dáng riêng tuỳ vào không gian và số lượng sách. Nhưng nếu phải chọn một điều để bắt đầu, chúng tôi nghĩ nên bắt đầu từ chỗ các em đứng, chứ không phải từ chỗ người lớn quen sắp xếp.",
      },
    ],
  },
  "chon-sach-cho-cac-em-cap-mot": {
    standfirst:
      "Gợi ý những cuốn dễ đọc, chữ to, nội dung trong sáng, hợp với các em mới biết đọc.",
    readMinutes: 4,
    body: [
      {
        type: "p",
        content:
          "Các em cấp một mới tập đọc thường bỏ cuộc rất nhanh nếu cuốn sách quá dày hoặc chữ quá nhỏ. Khi chọn sách cho kệ thấp nhất của tủ sách, chúng tôi ưu tiên những cuốn mỏng, chữ to, câu ngắn, và có tranh minh hoạ đi kèm gần như mỗi trang.",
      },
      {
        type: "p",
        content:
          "Nội dung cũng nên đơn giản và gần gũi — chuyện con vật, chuyện gia đình, chuyện trường lớp — hơn là những câu chuyện nhiều tình tiết khó theo dõi. Một cuốn sách khiến em đọc hết trong một buổi tối và muốn đọc lại là một cuốn sách tốt, dù nó không dày.",
      },
      {
        type: "p",
        content:
          "Chúng tôi cũng để ý không chọn sách có nội dung buồn hoặc nặng nề cho lứa tuổi này. Các em cấp một cần thấy đọc sách là vui trước, rồi mới đến chuyện đọc sách hay.",
      },
    ],
  },
  "khi-mot-cuon-sach-bi-mat": {
    standfirst:
      "Ghi nhận thế nào cho đúng, và vì sao không nên xoá cuốn sách khỏi hệ thống.",
    readMinutes: 3,
    body: [
      {
        type: "p",
        content:
          "Sách trong một tủ sách giáo xứ thỉnh thoảng sẽ mất — có khi vì bạn đọc quên trả, có khi thất lạc thật sự. Điều quan trọng là ghi nhận đúng, thay vì cố xoá dấu vết như chưa từng có chuyện gì xảy ra.",
      },
      {
        type: "p",
        content:
          "Khi xác định một bản sách đã mất, chúng tôi không xoá bản đó khỏi hệ thống mà chỉ đổi trạng thái. Nhờ vậy, ai xem lại đầu sách đó vẫn biết tủ sách từng có bao nhiêu bản, và mất bao nhiêu bản theo thời gian.",
      },
      {
        type: "p",
        content:
          "Giữ lại lịch sử như vậy cũng giúp tủ sách nhìn ra được sách nào hay bị mất, để cân nhắc khi mua hoặc nhận sách tặng bổ sung.",
      },
    ],
  },
  "day-cac-em-tu-muon-sach": {
    standfirst: "Vài cách để chính các em làm quen với việc tự tìm và tự trả sách.",
    readMinutes: 4,
    body: [
      {
        type: "p",
        content:
          "Một tủ sách chỉ có một hai người lớn trông coi sẽ rất chật vật nếu mọi việc mượn trả đều phải qua tay người lớn. Chúng tôi bắt đầu để các em lớn hơn, đã quen tủ sách, tự tìm sách và tự mang ra bàn ghi mượn.",
      },
      {
        type: "p",
        content:
          "Ban đầu chỉ là những việc nhỏ như tự tìm đúng mã sách, tự ghi tên vào sổ. Sau một thời gian, vài em đã có thể hướng dẫn lại cho các em mới đến, gần như trở thành một đội nhỏ giúp việc cho tủ sách.",
      },
      {
        type: "p",
        content:
          "Cách này không chỉ đỡ việc cho người lớn, mà còn khiến các em thấy tủ sách là của mình, không phải một nơi chỉ đến mượn rồi về.",
      },
    ],
  },
  "nhan-sach-tang-the-nao-cho-gon": {
    standfirst: "Không phải cuốn nào cũng nên nhận. Vài tiêu chí đơn giản.",
    readMinutes: 3,
    body: [
      {
        type: "p",
        content:
          "Tủ sách giáo xứ hay nhận được sách tặng, nhưng không phải cuốn nào cũng nên giữ lại. Nhận hết mọi cuốn sách được tặng rất dễ khiến kệ sách đầy lên nhanh chóng mà chất lượng lại không đều.",
      },
      {
        type: "p",
        content:
          "Chúng tôi chỉ nhận sách còn nguyên vẹn, nội dung phù hợp lứa tuổi đang đọc ở tủ sách, và không trùng quá nhiều với những đầu sách đã có sẵn. Sách cũ nát hoặc không còn phù hợp, chúng tôi cảm ơn nhưng không xếp lên kệ.",
      },
      {
        type: "p",
        content:
          "Nói rõ tiêu chí này ngay từ đầu với người muốn tặng sách cũng giúp việc từ chối bớt khó xử hơn nhiều.",
      },
    ],
  },
  "in-nhan-ma-cho-tung-ban-sach": {
    standfirst: "Cách đánh mã DT-0142 và vì sao mỗi bản cần một mã riêng.",
    readMinutes: 4,
    body: [
      {
        type: "p",
        content:
          "Mỗi bản sách trong tủ sách Đồng Tháp đều có một mã riêng, dạng như DT-0142, dán ngay trên gáy sách. Mã này là thứ giúp việc cho mượn và nhận trả nhanh và chính xác hơn rất nhiều.",
      },
      {
        type: "p",
        content:
          "Khi có nhiều bản của cùng một đầu sách, mỗi bản vẫn được đánh số riêng thay vì dùng chung một mã. Nhờ vậy quản lý luôn biết chính xác bản nào đang ở đâu, không phải đoán.",
      },
      {
        type: "p",
        content:
          "Việc in và dán nhãn mất chút thời gian lúc đầu, nhưng về sau lại tiết kiệm rất nhiều công sức mỗi lần cho mượn hay kiểm kê sách trên kệ.",
      },
    ],
  },
};

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  const article = ARTICLES[slug];
  if (!post || !article) notFound();

  const others = posts.filter((p) => p.slug !== slug).slice(0, 3);

  return (
    <>
      <MarketingHeader active="bai-viet" />

      <main className="mx-auto max-w-[680px] px-6 py-12">
        <Link
          href="/bai-viet"
          className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
          Quay lại danh sách bài viết
        </Link>

        <p className="mt-4 text-[14px] text-meta">
          {post.date} · {post.author} · đọc khoảng {article.readMinutes} phút
        </p>

        <h1 className="mt-2 text-[28px] leading-tight font-semibold">
          {post.title}
        </h1>

        <p className="mt-4 text-[18px] leading-relaxed text-ink/80">
          {article.standfirst}
        </p>

        <div
          aria-hidden
          className="mt-8 h-[220px] w-full rounded-card border border-hairline bg-paper"
        />

        <div className="mt-8 space-y-6 text-[16px] leading-[1.8]">
          {article.body.map((block, i) => {
            if (block.type === "h2") {
              return (
                <h2 key={i} className="pt-2 text-xl font-semibold">
                  {block.content}
                </h2>
              );
            }
            if (block.type === "quote") {
              return (
                <blockquote
                  key={i}
                  className="border-l-[3px] border-terracotta py-1 pl-5 text-[20px] leading-snug font-medium"
                >
                  {block.content}
                </blockquote>
              );
            }
            if (block.type === "ul") {
              return (
                <ul key={i} className="list-disc space-y-2 pl-5">
                  {block.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              );
            }
            return <p key={i}>{block.content}</p>;
          })}
        </div>

        <div className="mt-12 flex items-center gap-3 border-t border-hairline pt-8">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-paper text-[17px] font-semibold text-leather"
          >
            {post.author.split(" ").at(-1)?.charAt(0)}
          </span>
          <div>
            <p className="text-[16px] font-medium">{post.author}</p>
            <p className="text-[14px] text-meta">Quản trị viên OLibra</p>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Bài viết khác</h2>
          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            {others.map((p) => (
              <Card key={p.slug} className="flex flex-col p-4">
                <div
                  aria-hidden
                  className="h-16 w-full rounded-control border border-hairline bg-paper"
                />
                <p className="mt-3 text-[13px] text-meta">{p.date}</p>
                <h3 className="mt-1 line-clamp-2 text-[15px] leading-snug font-semibold">
                  {p.title}
                </h3>
                <Link
                  href={`/bai-viet/${p.slug}`}
                  className="mt-2 inline-flex min-h-11 items-center text-[14px] font-medium text-sage hover:underline"
                >
                  Đọc tiếp
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
