import type { CopyStatus } from "./status";

/**
 * Static sample content. No database, no auth — every screen renders from
 * these typed objects so the UI can be judged before any logic exists.
 * Names and titles match the design work exactly.
 */

/**
 * Whoever runs OLibra itself, as opposed to any one bookshelf.
 *
 * Shown on the public contact page, which is the only route a parish with no
 * shelf yet has to reach anybody. It lives here rather than inline in that
 * page because a change of administrator must not require a deploy — the
 * super administrator edits these three fields in /quan-tri/cai-dat.
 */
export type SiteContact = {
  name: string;
  phone: string;
  hours: string;
};

export const siteContact: SiteContact = {
  name: "Giuse Trần Quốc Anh",
  phone: "0901 111 222",
  hours: "Trong tuần, 8:00 đến 17:00",
};

export type Shelf = {
  slug: string;
  name: string;
  location: string;
  hours: string;
  keeper: string;
  phone: string;
  titles: number;
  copies: number;
  readers: number;
  onLoan: number;
};

export const shelf: Shelf = {
  slug: "dong-thap",
  name: "Tủ sách Đồng Tháp",
  location: "Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú",
  hours: "Mở sau lễ Chúa nhật · 9:00 đến 11:00",
  keeper: "Maria Nguyễn Thị Lan",
  phone: "0912 345 678",
  titles: 214,
  copies: 268,
  readers: 96,
  onLoan: 31,
};

export const shelves: Shelf[] = [
  shelf,
  {
    slug: "can-tho",
    name: "Tủ sách Cần Thơ",
    location: "Nhà xứ Cần Thơ, phường An Bình",
    hours: "Mở chiều thứ Bảy · 15:00 đến 17:00",
    keeper: "Giuse Trần Minh Khôi",
    phone: "0908 222 111",
    titles: 318,
    copies: 402,
    readers: 124,
    onLoan: 47,
  },
  {
    slug: "ben-tre",
    name: "Tủ sách Bến Tre",
    location: "Nhà thờ Bến Tre, ấp Phú Lợi",
    hours: "Mở sau lễ Chúa nhật · 8:30 đến 10:30",
    keeper: "Anna Lê Thị Hường",
    phone: "0977 456 789",
    titles: 156,
    copies: 190,
    readers: 61,
    onLoan: 18,
  },
  {
    slug: "vinh-long",
    name: "Tủ sách Vĩnh Long",
    location: "Giáo họ Vĩnh Long, ấp Hoà Bình",
    hours: "Mở sáng Chúa nhật · 7:30 đến 9:30",
    keeper: "Phêrô Nguyễn Văn Sơn",
    phone: "0933 654 321",
    titles: 124,
    copies: 148,
    readers: 43,
    onLoan: 12,
  },
];

export function shelfBySlug(slug: string) {
  return shelves.find((s) => s.slug === slug);
}

export type Book = {
  slug: string;
  title: string;
  author: string;
  translator?: string;
  publisher: string;
  year: number;
  pages: number;
  category: string;
  status: CopyStatus;
  codes: string;
  copiesTotal: number;
  copiesAvailable: number;
  description: string[];
  /** Present when a copy is in someone's hands, so the public panel can name them. */
  loan?: { holder: string; daysLeft: number; due: string; queue: number };
  comments?: { name: string; date: string; text: string }[];
};

export const books: Book[] = [
  {
    slug: "de-men-phieu-luu-ky",
    title: "Dế Mèn Phiêu Lưu Ký",
    author: "Tô Hoài",
    publisher: "Kim Đồng",
    year: 2019,
    pages: 176,
    category: "Văn học thiếu nhi",
    status: "available",
    codes: "DT-0140 – DT-0142",
    copiesTotal: 3,
    copiesAvailable: 2,
    description: [
      "Dế Mèn là một chú dế thanh niên khoẻ mạnh, bướng bỉnh và hơi kiêu ngạo. Sau một trò nghịch dại khiến người hàng xóm phải trả giá, chú ân hận và quyết định rời khỏi cái hang quen thuộc của mình.",
      "Trên đường phiêu lưu, Dế Mèn kết bạn với Dế Trũi, đi qua nhiều vùng đất lạ và gặp không ít hiểm nguy. Mỗi lần vấp ngã lại dạy chú một điều: về lòng khiêm nhường, về tình bạn, và về việc sống tử tế với những người quanh mình.",
    ],
    comments: [
      {
        name: "Têrêsa Lê Ngọc Ánh",
        date: "28/07",
        text: "Em thích đoạn Dế Mèn gặp Dế Trũi nhất. Đọc xong em muốn đọc lại.",
      },
      {
        name: "Giuse Trần Minh",
        date: "21/07",
        text: "Sách hay, chữ to dễ đọc. Em đọc hết trong ba ngày.",
      },
    ],
  },
  {
    slug: "hoang-tu-be",
    title: "Hoàng Tử Bé",
    author: "Antoine de Saint-Exupéry",
    translator: "Nguyễn Tấn Đại",
    publisher: "Hội Nhà Văn",
    year: 2020,
    pages: 128,
    category: "Văn học nước ngoài",
    status: "onloan",
    codes: "DT-0087",
    copiesTotal: 1,
    copiesAvailable: 0,
    description: [
      "Hoàng tử bé sống một mình trên một hành tinh nhỏ xíu, chỉ có ba ngọn núi lửa và một bông hồng mà cậu hết lòng chăm sóc. Một ngày, cậu rời hành tinh của mình để đi tìm hiểu thế giới.",
      "Cậu gặp những người lớn kỳ lạ ở các hành tinh khác, rồi gặp con cáo trên Trái Đất. Chính con cáo đã nói với cậu điều quan trọng nhất: người ta chỉ nhìn thấy rõ bằng trái tim, còn điều cốt yếu thì mắt thường không nhìn thấy được.",
    ],
    loan: {
      holder: "Têrêsa Lê Ngọc Ánh",
      daysLeft: 4,
      due: "Chúa nhật 20/08",
      queue: 2,
    },
    comments: [
      {
        name: "Maria Nguyễn Thị Lan",
        date: "30/07",
        text: "Truyện buồn nhưng rất đẹp. Em đọc lần hai mới hiểu đoạn con cáo.",
      },
      {
        name: "Giuse Trần Minh",
        date: "18/07",
        text: "Em chờ mãi mới tới lượt mượn, đọc xong thấy đáng chờ.",
      },
    ],
  },
  {
    slug: "totto-chan-ben-cua-so",
    title: "Totto-chan Bên Cửa Sổ",
    author: "Kuroyanagi Tetsuko",
    publisher: "Nhã Nam",
    year: 2018,
    pages: 288,
    category: "Văn học nước ngoài",
    status: "overdue",
    codes: "DT-0155",
    copiesTotal: 1,
    copiesAvailable: 0,
    description: [
      "Totto-chan là một cô bé hiếu động đến mức bị đuổi khỏi trường cũ ngay từ lớp một. Mẹ em tìm cho em một ngôi trường khác, nơi lớp học là những toa tàu cũ và thầy hiệu trưởng chịu ngồi nghe em nói suốt bốn tiếng đồng hồ.",
      "Cuốn sách kể lại những ngày ở ngôi trường ấy bằng giọng kể trong trẻo của chính Totto-chan, và cho thấy một đứa trẻ sẽ lớn lên thế nào khi được người lớn thật lòng lắng nghe.",
    ],
  },
  {
    slug: "dat-rung-phuong-nam",
    title: "Đất Rừng Phương Nam",
    author: "Đoàn Giỏi",
    publisher: "Kim Đồng",
    year: 2021,
    pages: 320,
    category: "Văn học thiếu nhi",
    status: "overdue",
    codes: "DT-0201 – DT-0203",
    copiesTotal: 3,
    copiesAvailable: 0,
    description: [
      "An là cậu bé lạc mất gia đình trong những ngày loạn lạc, phiêu bạt khắp miền đất phương Nam. Cậu được vợ chồng bác Hai Ngan cưu mang và cùng họ đi qua rừng tràm, sông nước, chợ nổi.",
      "Qua mắt của An, vùng đất Nam Bộ hiện lên vừa dữ dội vừa hào phóng, với những con người bộc trực, nghĩa tình và rất đỗi gan góc.",
    ],
  },
  {
    slug: "chuyen-con-meo-day-hai-au-bay",
    title: "Chuyện Con Mèo Dạy Hải Âu Bay",
    author: "Luis Sepúlveda",
    publisher: "Nhã Nam",
    year: 2017,
    pages: 160,
    category: "Văn học nước ngoài",
    status: "available",
    codes: "DT-0118",
    copiesTotal: 1,
    copiesAvailable: 1,
    description: [
      "Con mèo mun Zorba hứa với một cô hải âu đang hấp hối ba điều: không ăn quả trứng, chăm cho trứng nở, và dạy con hải âu con biết bay.",
      "Giữ được hai lời hứa đầu đã khó, lời hứa thứ ba gần như bất khả. Nhưng cả xóm mèo đã cùng nhau làm điều đó, và câu chuyện trở thành một bài học rất dịu dàng về việc yêu thương một kẻ khác mình.",
    ],
  },
  {
    slug: "cho-toi-xin-mot-ve-di-tuoi-tho",
    title: "Cho Tôi Xin Một Vé Đi Tuổi Thơ",
    author: "Nguyễn Nhật Ánh",
    publisher: "Trẻ",
    year: 2019,
    pages: 208,
    category: "Văn học Việt Nam",
    status: "available",
    codes: "DT-0092",
    copiesTotal: 1,
    copiesAvailable: 1,
    description: [
      "Bốn đứa trẻ tám tuổi quyết định rằng cuộc sống người lớn quá buồn tẻ, và bày ra đủ trò để đặt lại tên cho thế giới của mình.",
      "Người kể chuyện nhớ lại tất cả khi đã trưởng thành, và nhận ra tuổi thơ không phải là nơi để quay về, mà là nơi để giữ lấy.",
    ],
  },
  {
    slug: "kinh-van-hoa-tap-4",
    title: "Kính Vạn Hoa tập 4",
    author: "Nguyễn Nhật Ánh",
    publisher: "Trẻ",
    year: 2020,
    pages: 184,
    category: "Văn học thiếu nhi",
    status: "overdue",
    codes: "DT-0061",
    copiesTotal: 1,
    copiesAvailable: 0,
    description: [
      "Quý ròm, nhỏ Hạnh và Tiểu Long lại vướng vào một chuyện dở khóc dở cười ở trường, và như mọi lần, cách gỡ rối của ba đứa còn rắc rối hơn cả chuyện ban đầu.",
    ],
  },
  {
    slug: "nhung-tam-long-cao-ca",
    title: "Những Tấm Lòng Cao Cả",
    author: "Edmondo De Amicis",
    publisher: "Kim Đồng",
    year: 2018,
    pages: 344,
    category: "Văn học nước ngoài",
    status: "held",
    codes: "DT-0112",
    copiesTotal: 1,
    copiesAvailable: 0,
    description: [
      "Cuốn nhật ký của cậu bé Enrico ghi lại một năm học, với thầy cô, bạn bè và những câu chuyện hằng tháng mà thầy giáo đọc cho cả lớp nghe.",
    ],
  },
  {
    slug: "tuoi-tho-du-doi",
    title: "Tuổi Thơ Dữ Dội",
    author: "Phùng Quán",
    publisher: "Kim Đồng",
    year: 2017,
    pages: 640,
    category: "Văn học Việt Nam",
    status: "available",
    codes: "DT-0044",
    copiesTotal: 1,
    copiesAvailable: 1,
    description: [
      "Câu chuyện về những thiếu niên trinh sát của một thời rất khác.",
    ],
  },
  {
    slug: "goc-san-va-khoang-troi",
    title: "Góc Sân Và Khoảng Trời",
    author: "Trần Đăng Khoa",
    publisher: "Kim Đồng",
    year: 2019,
    pages: 128,
    category: "Thơ thiếu nhi",
    status: "available",
    codes: "DT-0071",
    copiesTotal: 1,
    copiesAvailable: 1,
    description: ["Tập thơ viết từ khi tác giả còn là một cậu bé ở làng."],
  },
  {
    slug: "khong-gia-dinh",
    title: "Không Gia Đình",
    author: "Hector Malot",
    publisher: "Văn Học",
    year: 2016,
    pages: 480,
    category: "Văn học nước ngoài",
    status: "available",
    codes: "DT-0129",
    copiesTotal: 1,
    copiesAvailable: 1,
    description: ["Rémi đi khắp nước Pháp cùng gánh xiếc rong của cụ Vitalis."],
  },
  {
    slug: "chiec-luoc-nga",
    title: "Chiếc Lược Ngà",
    author: "Nguyễn Quang Sáng",
    publisher: "Trẻ",
    year: 2018,
    pages: 112,
    category: "Văn học Việt Nam",
    status: "retired",
    codes: "DT-0033",
    copiesTotal: 2,
    copiesAvailable: 0,
    description: ["Tập truyện ngắn về tình cha con trong chiến tranh."],
  },
];

export function bookBySlug(slug: string) {
  return books.find((b) => b.slug === slug);
}

export type Reader = {
  id: string;
  saintName: string;
  name: string;
  fullName: string;
  born: string;
  age: number;
  group: string;
  parish: string;
  phone: string;
  username: string;
  father: string;
  mother: string;
  holding: number;
  membership: "active" | "pending" | "suspended" | "left";
};

export const READER_STATUS: Record<
  Reader["membership"],
  { label: string; ink: string; fill: string }
> = {
  active: {
    label: "Đang hoạt động",
    ink: "text-available",
    fill: "bg-available/10",
  },
  pending: { label: "Chờ duyệt", ink: "text-held", fill: "bg-held/10" },
  suspended: { label: "Tạm khoá", ink: "text-onloan", fill: "bg-onloan/10" },
  left: { label: "Đã rời", ink: "text-retired", fill: "bg-retired/10" },
};

export const readers: Reader[] = [
  {
    id: "lan",
    saintName: "Maria",
    name: "Nguyễn Thị Lan",
    fullName: "Maria Nguyễn Thị Lan",
    born: "12/05/2015",
    age: 11,
    group: "Tổ 3",
    parish: "Giáo họ Thánh Tâm",
    phone: "0912 345 678",
    username: "lan.nguyen",
    father: "Giuse Nguyễn Văn Hoà",
    mother: "Anna Trần Thị Mai",
    holding: 1,
    membership: "active",
  },
  {
    id: "minh",
    saintName: "Giuse",
    name: "Trần Minh",
    fullName: "Giuse Trần Minh",
    born: "03/09/2014",
    age: 11,
    group: "Tổ 3",
    parish: "Giáo họ Thánh Tâm",
    phone: "0912 345 678",
    username: "minh.tran",
    father: "Giuse Trần Văn Hùng",
    mother: "Maria Đỗ Thị Nga",
    holding: 3,
    membership: "active",
  },
  {
    id: "anh",
    saintName: "Têrêsa",
    name: "Lê Ngọc Ánh",
    fullName: "Têrêsa Lê Ngọc Ánh",
    born: "21/01/2016",
    age: 10,
    group: "Tổ 1",
    parish: "Giáo họ Mân Côi",
    phone: "0925 888 111",
    username: "anh.le",
    father: "Phêrô Lê Văn Tâm",
    mother: "Maria Ngô Thị Bích",
    holding: 0,
    membership: "active",
  },
  {
    id: "ha",
    saintName: "Anna",
    name: "Phạm Thu Hà",
    fullName: "Anna Phạm Thu Hà",
    born: "07/07/2015",
    age: 11,
    group: "Tổ 2",
    parish: "Giáo họ Thánh Tâm",
    phone: "0934 111 222",
    username: "ha.pham",
    father: "Giuse Phạm Văn Long",
    mother: "Maria Vũ Thị Yến",
    holding: 3,
    membership: "pending",
  },
  {
    id: "binh",
    saintName: "Phêrô",
    name: "Nguyễn Văn Bình",
    fullName: "Phêrô Nguyễn Văn Bình",
    born: "15/11/2013",
    age: 12,
    group: "Tổ 4",
    parish: "Giáo họ Mân Côi",
    phone: "0987 654 321",
    username: "binh.nguyen",
    father: "Giuse Nguyễn Văn Tư",
    mother: "Anna Lê Thị Thu",
    holding: 1,
    membership: "suspended",
  },
  {
    id: "linh",
    saintName: "Maria",
    name: "Vũ Khánh Linh",
    fullName: "Maria Vũ Khánh Linh",
    born: "02/03/2016",
    age: 10,
    group: "Tổ 1",
    parish: "Giáo họ Mân Côi",
    phone: "0966 333 777",
    username: "linh.vu",
    father: "Giuse Vũ Văn Nam",
    mother: "Maria Bùi Thị Hoa",
    holding: 2,
    membership: "active",
  },
  {
    id: "thang",
    saintName: "Gioan",
    name: "Bùi Đức Thắng",
    fullName: "Gioan Bùi Đức Thắng",
    born: "19/08/2012",
    age: 13,
    group: "Tổ 2",
    parish: "Giáo họ Thánh Tâm",
    phone: "0911 222 333",
    username: "thang.bui",
    father: "Phêrô Bùi Văn Chính",
    mother: "Anna Trịnh Thị Nhàn",
    holding: 0,
    membership: "left",
  },
];

export type Announcement = {
  slug: string;
  title: string;
  excerpt: string;
  body: string[];
  date: string;
  author: string;
  pinned?: boolean;
};

export const announcements: Announcement[] = [
  {
    slug: "nghi-chua-nhat-13-08",
    title: "Tủ sách nghỉ Chúa nhật 13/08",
    excerpt:
      "Chúa nhật tuần tới nhà xứ có lễ Chầu nên tủ sách không mở. Các em trả sách vào Chúa nhật kế tiếp, không tính trễ hạn.",
    body: [
      "Chúa nhật tuần tới nhà xứ có lễ Chầu nên tủ sách không mở cửa. Các em đang giữ sách cứ yên tâm, tủ sách sẽ không tính trễ hạn trong tuần này.",
      "Các em mang sách trả vào Chúa nhật kế tiếp, ngày 20/08, sau lễ như thường lệ. Nếu có việc gấp, các em nhắn cho cô Lan theo số 0912 345 678.",
    ],
    date: "02/08",
    author: "Maria Nguyễn Thị Lan",
    pinned: true,
  },
  {
    slug: "them-12-cuon-sach-moi",
    title: "Đã có thêm 12 cuốn sách mới",
    excerpt:
      "Nhờ gia đình bác Hoà tặng, tủ sách vừa nhận thêm 12 cuốn truyện thiếu nhi. Các em ghé xem nhé.",
    body: [
      "Nhờ gia đình bác Hoà tặng, tủ sách vừa nhận thêm 12 cuốn truyện thiếu nhi, trong đó có Đất Rừng Phương Nam và mấy tập Kính Vạn Hoa.",
      "Sách đã được dán mã và xếp lên kệ. Các em ghé xem sau lễ Chúa nhật nhé.",
    ],
    date: "28/07",
    author: "Maria Nguyễn Thị Lan",
  },
  {
    slug: "nhac-han-tra-sach",
    title: "Nhắc các em về hạn trả sách",
    excerpt:
      "Mỗi lượt mượn là 14 ngày. Các em xem hạn trả ngay trong trang của mình nhé.",
    body: [
      "Mỗi lượt mượn là 14 ngày. Các em xem hạn trả ngay trong trang của mình, tủ sách cũng sẽ báo trước ba ngày.",
    ],
    date: "12/07",
    author: "Maria Nguyễn Thị Lan",
  },
  {
    slug: "ban-doc-cham-nhat-thang-6",
    title: "Danh sách các bạn đọc chăm nhất tháng 6",
    excerpt: "Xin chúc mừng các em đã đọc nhiều sách nhất trong tháng vừa qua.",
    body: ["Xin chúc mừng các em đã đọc nhiều sách nhất trong tháng vừa qua."],
    date: "30/06",
    author: "Maria Nguyễn Thị Lan",
  },
];

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string;
};

export const posts: Post[] = [
  {
    slug: "cach-sap-xep-mot-tu-sach-giao-xu",
    title: "Cách sắp xếp một tủ sách giáo xứ",
    excerpt:
      "Sau một năm chạy tủ sách Đồng Tháp, chúng tôi rút ra vài điều rất đơn giản về cách xếp sách, cách đánh mã và cách giữ cho kệ sách không rối.",
    date: "02/08/2026",
    author: "Giuse Trần Quốc Anh",
  },
  {
    slug: "chon-sach-cho-cac-em-cap-mot",
    title: "Chọn sách cho các em cấp một",
    excerpt:
      "Gợi ý những cuốn dễ đọc, chữ to, nội dung trong sáng, hợp với các em mới biết đọc.",
    date: "21/07/2026",
    author: "Giuse Trần Quốc Anh",
  },
  {
    slug: "khi-mot-cuon-sach-bi-mat",
    title: "Khi một cuốn sách bị mất",
    excerpt:
      "Ghi nhận thế nào cho đúng, và vì sao không nên xoá cuốn sách khỏi hệ thống.",
    date: "05/07/2026",
    author: "Giuse Trần Quốc Anh",
  },
  {
    slug: "day-cac-em-tu-muon-sach",
    title: "Dạy các em tự mượn sách",
    excerpt: "Vài cách để chính các em làm quen với việc tự tìm và tự trả sách.",
    date: "28/06/2026",
    author: "Giuse Trần Quốc Anh",
  },
  {
    slug: "nhan-sach-tang-the-nao-cho-gon",
    title: "Nhận sách tặng thế nào cho gọn",
    excerpt: "Không phải cuốn nào cũng nên nhận. Vài tiêu chí đơn giản.",
    date: "14/06/2026",
    author: "Giuse Trần Quốc Anh",
  },
  {
    slug: "in-nhan-ma-cho-tung-ban-sach",
    title: "In nhãn mã cho từng bản sách",
    excerpt: "Cách đánh mã DT-0142 và vì sao mỗi bản cần một mã riêng.",
    date: "30/05/2026",
    author: "Giuse Trần Quốc Anh",
  },
];

/** Recent manager activity, written as ordinary Vietnamese sentences. */
export const activity = [
  {
    text: "Bạn đã cho Giuse Trần Minh mượn",
    book: "Dế Mèn Phiêu Lưu Ký",
    tail: "",
    time: "14:32",
  },
  {
    text: "Bạn đã nhận trả",
    book: "Hoàng Tử Bé",
    tail: "từ Têrêsa Lê Ngọc Ánh · Nguyên vẹn",
    time: "14:05",
  },
  {
    text: "Bạn đã duyệt tài khoản của Anna Phạm Thu Hà",
    book: "",
    tail: "",
    time: "11:20",
  },
  {
    text: "Bạn đã thêm sách",
    book: "Đất Rừng Phương Nam",
    tail: "· 2 bản",
    time: "09:48",
  },
];

export const dashboardStats = [
  { key: "qua-han", label: "Quá hạn", value: 3, href: "qua-han" },
  {
    key: "cho-duyet",
    label: "Chờ duyệt tài khoản",
    value: 5,
    href: "dang-ky-cho-duyet",
  },
  { key: "yeu-cau", label: "Yêu cầu mượn", value: 2, href: "yeu-cau-muon" },
  { key: "binh-luan", label: "Bình luận chờ duyệt", value: 1, href: "binh-luan" },
] as const;

export const overdueLoans = [
  {
    title: "Đất Rừng Phương Nam",
    author: "Đoàn Giỏi",
    code: "DT-0203",
    borrower: "Phêrô Nguyễn Văn Bình",
    phone: "0987 654 321",
    lateDays: 21,
    due: "16/07",
  },
  {
    title: "Totto-chan Bên Cửa Sổ",
    author: "Kuroyanagi Tetsuko",
    code: "DT-0155",
    borrower: "Anna Phạm Thu Hà",
    phone: "0934 111 222",
    lateDays: 9,
    due: "28/07",
  },
  {
    title: "Kính Vạn Hoa tập 4",
    author: "Nguyễn Nhật Ánh",
    code: "DT-0061",
    borrower: "Giuse Trần Minh",
    phone: "0912 345 678",
    lateDays: 2,
    due: "04/08",
  },
];

/**
 * Who is holding what — the single source of truth for active loans.
 *
 * Three pages previously each decided this for themselves, and they
 * disagreed: the reader profile derived held books with
 * `books.slice(0, reader.holding)`, which handed Giuse Trần Minh a copy of
 * Hoàng Tử Bé that the catalogue said Têrêsa Lê Ngọc Ánh had. Derive from
 * here instead of inventing per page.
 */
export type Loan = {
  bookSlug: string;
  code: string;
  readerId: string;
  borrowedOn: string;
  /** A date, never a timestamp — a book is due at the end of a day (§5.4). */
  dueOn: string;
  status: Extract<CopyStatus, "onloan" | "overdue">;
  /** Negative means overdue by that many days. */
  daysLeft: number;
};

export const loans: Loan[] = [
  {
    bookSlug: "de-men-phieu-luu-ky",
    code: "DT-0141",
    readerId: "minh",
    borrowedOn: "06/08",
    dueOn: "Chúa nhật 20/08",
    status: "onloan",
    daysLeft: 14,
  },
  {
    bookSlug: "totto-chan-ben-cua-so",
    code: "DT-0155",
    readerId: "minh",
    borrowedOn: "04/08",
    dueOn: "18/08",
    status: "onloan",
    daysLeft: 2,
  },
  {
    bookSlug: "kinh-van-hoa-tap-4",
    code: "DT-0061",
    readerId: "minh",
    borrowedOn: "23/07",
    dueOn: "04/08",
    status: "overdue",
    daysLeft: -2,
  },
  {
    bookSlug: "hoang-tu-be",
    code: "DT-0087",
    readerId: "anh",
    borrowedOn: "23/07",
    dueOn: "Chúa nhật 20/08",
    status: "onloan",
    daysLeft: 4,
  },
  {
    bookSlug: "dat-rung-phuong-nam",
    code: "DT-0203",
    readerId: "binh",
    borrowedOn: "02/07",
    dueOn: "16/07",
    status: "overdue",
    daysLeft: -21,
  },
];

export function loansByReader(readerId: string) {
  return loans.filter((l) => l.readerId === readerId);
}

export function loanForBook(bookSlug: string) {
  return loans.find((l) => l.bookSlug === bookSlug);
}

export function readerById(id: string) {
  return readers.find((r) => r.id === id);
}

/**
 * Cover artwork path for a title, or undefined if we have none and the kraft
 * placeholder should stand in.
 *
 * Looked up by title so existing `BookCover title={...}` call sites pick the
 * artwork up without every page having to thread a slug through. Once a real
 * data layer exists the cover should simply be a field on the book.
 */
export function coverForTitle(title: string) {
  const book = books.find((b) => b.title === title);
  return book ? `/covers/${book.slug}.svg` : undefined;
}
