import type { CopyStatus } from "./status";
import type { ParishTaxonomy, ParishUnit } from "@/domain/members/parish-taxonomy";

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
  /**
   * How this shelf's parish subdivides its people (design
   * 2026-08-08-parish-taxonomy-design.md, §3.2). Configured in
   * `/quan-tri/tu-sach`, read everywhere a reader's parish line is shown.
   *
   * The four shelves below are deliberately not shaped alike — one level,
   * two nested, two flat — because fixtures that all look the same would
   * hide exactly the bugs this module exists to catch (design §2's table).
   */
  parishTaxonomy: ParishTaxonomy;
  /** This shelf's own units — design §7: units belong to one bookshelf. */
  parishUnits: ParishUnit[];
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
  // Design §2, row 3: both levels, tổ numbered within each giáo họ — so
  // "Tổ 1" exists once under Thánh Tâm and again, a different unit, under
  // Mân Côi.
  parishTaxonomy: {
    levels: 2,
    nested: true,
    level1Label: "Giáo họ",
    level2Label: "Tổ",
  },
  parishUnits: [
    {
      id: "dt-gh-thanh-tam",
      level: 1,
      parentId: null,
      name: "Giáo họ Thánh Tâm",
      sortOrder: 1,
      deletedAt: null,
    },
    {
      id: "dt-gh-man-coi",
      level: 1,
      parentId: null,
      name: "Giáo họ Mân Côi",
      sortOrder: 2,
      deletedAt: null,
    },
    {
      id: "dt-to-tt-1",
      level: 2,
      parentId: "dt-gh-thanh-tam",
      name: "Tổ 1",
      sortOrder: 1,
      deletedAt: null,
    },
    {
      id: "dt-to-tt-2",
      level: 2,
      parentId: "dt-gh-thanh-tam",
      name: "Tổ 2",
      sortOrder: 2,
      deletedAt: null,
    },
    {
      id: "dt-to-tt-3",
      level: 2,
      parentId: "dt-gh-thanh-tam",
      name: "Tổ 3",
      sortOrder: 3,
      deletedAt: null,
    },
    {
      id: "dt-to-mc-1",
      level: 2,
      parentId: "dt-gh-man-coi",
      name: "Tổ 1",
      sortOrder: 1,
      deletedAt: null,
    },
    {
      id: "dt-to-mc-2",
      level: 2,
      parentId: "dt-gh-man-coi",
      name: "Tổ 2",
      sortOrder: 2,
      deletedAt: null,
    },
    {
      id: "dt-to-mc-3",
      level: 2,
      parentId: "dt-gh-man-coi",
      name: "Tổ 3",
      sortOrder: 3,
      // The one soft-deleted unit in these fixtures (design §7: no hard
      // delete of a unit a member references). Referenced by no reader
      // below, so this exercises the split cleanly — gone from every
      // picker, but never claimed to have never existed.
      deletedAt: "2026-06-01T00:00:00Z",
    },
    {
      id: "dt-to-mc-4",
      level: 2,
      parentId: "dt-gh-man-coi",
      name: "Tổ 4",
      sortOrder: 4,
      deletedAt: null,
    },
  ],
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
    // Design §2, row 1: one flat level, called tổ.
    parishTaxonomy: {
      levels: 1,
      nested: false,
      level1Label: "Tổ",
      level2Label: "Tổ",
    },
    parishUnits: [
      {
        id: "ct-to-1",
        level: 1,
        parentId: null,
        name: "Tổ 1",
        sortOrder: 1,
        deletedAt: null,
      },
      {
        id: "ct-to-2",
        level: 1,
        parentId: null,
        name: "Tổ 2",
        sortOrder: 2,
        deletedAt: null,
      },
      {
        id: "ct-to-3",
        level: 1,
        parentId: null,
        name: "Tổ 3",
        sortOrder: 3,
        deletedAt: null,
      },
      {
        id: "ct-to-4",
        level: 1,
        parentId: null,
        name: "Tổ 4",
        sortOrder: 4,
        deletedAt: null,
      },
      {
        id: "ct-to-5",
        level: 1,
        parentId: null,
        name: "Tổ 5",
        sortOrder: 5,
        deletedAt: null,
      },
    ],
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
    // Design §2, row 2: one flat level, called giáo họ instead of tổ — this
    // shelf has no concept of tổ at all.
    parishTaxonomy: {
      levels: 1,
      nested: false,
      level1Label: "Giáo họ",
      level2Label: "Giáo họ",
    },
    parishUnits: [
      {
        id: "bt-gh-giuse",
        level: 1,
        parentId: null,
        name: "Giáo họ Thánh Giuse",
        sortOrder: 1,
        deletedAt: null,
      },
      {
        id: "bt-gh-phero",
        level: 1,
        parentId: null,
        name: "Giáo họ Thánh Phêrô",
        sortOrder: 2,
        deletedAt: null,
      },
    ],
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
    // Design §2, row 4: both levels, but tổ numbered across the whole
    // parish rather than within each giáo họ — every level-2 unit's
    // parentId is null, same as a shelf with nesting off.
    parishTaxonomy: {
      levels: 2,
      nested: false,
      level1Label: "Giáo họ",
      level2Label: "Tổ",
    },
    parishUnits: [
      {
        id: "vl-gh-anna",
        level: 1,
        parentId: null,
        name: "Giáo họ Thánh Anna",
        sortOrder: 1,
        deletedAt: null,
      },
      {
        id: "vl-gh-vo-nhiem",
        level: 1,
        parentId: null,
        name: "Giáo họ Đức Mẹ Vô Nhiễm",
        sortOrder: 2,
        deletedAt: null,
      },
      {
        id: "vl-to-1",
        level: 2,
        parentId: null,
        name: "Tổ 1",
        sortOrder: 1,
        deletedAt: null,
      },
      {
        id: "vl-to-2",
        level: 2,
        parentId: null,
        name: "Tổ 2",
        sortOrder: 2,
        deletedAt: null,
      },
      {
        id: "vl-to-3",
        level: 2,
        parentId: null,
        name: "Tổ 3",
        sortOrder: 3,
        deletedAt: null,
      },
      {
        id: "vl-to-4",
        level: 2,
        parentId: null,
        name: "Tổ 4",
        sortOrder: 4,
        deletedAt: null,
      },
      {
        id: "vl-to-5",
        level: 2,
        parentId: null,
        name: "Tổ 5",
        sortOrder: 5,
        deletedAt: null,
      },
    ],
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
    // DT-0140 available, DT-0141 on loan to Giuse Trần Minh (see `loans`),
    // DT-0142 lost (see `lostCopies`) — 1 + 1 + 1 = 3. A copy holds exactly
    // one state (INV-2), so this must never drift from those two lists.
    copiesAvailable: 1,
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
    // DT-0201 on loan to Maria Vũ Khánh Linh (see `loans`), DT-0202 lost (see
    // `lostCopies`), DT-0203 on loan to Phêrô Nguyễn Văn Bình and overdue
    // (see `loans`) — 1 + 1 + 1 = 3, none available. A copy holds exactly
    // one state (INV-2), so this must never drift from those two lists.
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
    // Its one copy is reported lost (see `lostCopies`) — an available count
    // above zero would contradict that directly (INV-2).
    status: "lost",
    codes: "DT-0118",
    copiesTotal: 1,
    copiesAvailable: 0,
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
  /**
   * References into a shelf's `parishUnits`, not free text (design §3.3).
   * Both stay nullable permanently (design §5) — a reader with neither is
   * not missing data, just not assigned to a group yet ("lộc" below).
   *
   * This array is not itself split by shelf — every screen that renders it
   * reuses the same list regardless of the shelf route it was reached
   * through, a pre-existing simplification this fix does not attempt to
   * undo. Most readers below carry ids from `shelf` (Tủ sách Đồng Tháp,
   * `levels: 2, nested: true`), because that is the shelf every screen
   * mostly demonstrates. Three are seeded with ids from the other three
   * shelves instead ("đức", "hoà", "tuấn"), specifically so the other three
   * rows of design §2's table — flat tổ, flat giáo họ, two flat levels — each
   * describe at least one real reader too, not just the nested case.
   */
  parishUnitL1Id: string | null;
  parishUnitL2Id: string | null;
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
    parishUnitL1Id: "dt-gh-thanh-tam",
    parishUnitL2Id: "dt-to-tt-3",
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
    parishUnitL1Id: "dt-gh-thanh-tam",
    parishUnitL2Id: "dt-to-tt-3",
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
    parishUnitL1Id: "dt-gh-man-coi",
    parishUnitL2Id: "dt-to-mc-1",
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
    parishUnitL1Id: "dt-gh-thanh-tam",
    parishUnitL2Id: "dt-to-tt-2",
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
    parishUnitL1Id: "dt-gh-man-coi",
    parishUnitL2Id: "dt-to-mc-4",
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
    parishUnitL1Id: "dt-gh-man-coi",
    parishUnitL2Id: "dt-to-mc-1",
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
    parishUnitL1Id: "dt-gh-thanh-tam",
    parishUnitL2Id: "dt-to-tt-2",
    phone: "0911 222 333",
    username: "thang.bui",
    father: "Phêrô Bùi Văn Chính",
    mother: "Anna Trịnh Thị Nhàn",
    holding: 0,
    membership: "left",
  },
  {
    id: "loc",
    saintName: "Phanxicô",
    name: "Nguyễn Văn Lộc",
    fullName: "Phanxicô Nguyễn Văn Lộc",
    born: "10/10/2015",
    age: 10,
    // Neither level set — a family between parishes, or a volunteer who
    // simply doesn't know yet (design §5). Renders as "Chưa có", not blank.
    parishUnitL1Id: null,
    parishUnitL2Id: null,
    phone: "0909 111 000",
    username: "loc.nguyen",
    father: "Giuse Nguyễn Văn Đức",
    mother: "Maria Lê Thị Hạnh",
    holding: 0,
    membership: "active",
  },
  {
    // Cần Thơ (design §2, row 1: one flat level, called tổ).
    id: "duc",
    saintName: "Đaminh",
    name: "Vũ Quang Đức",
    fullName: "Đaminh Vũ Quang Đức",
    born: "14/02/2015",
    age: 11,
    parishUnitL1Id: "ct-to-2",
    parishUnitL2Id: null,
    phone: "0908 333 222",
    username: "duc.vu",
    father: "Phêrô Vũ Văn Cường",
    mother: "Anna Ngô Thị Loan",
    holding: 1,
    membership: "active",
  },
  {
    // Bến Tre (design §2, row 2: one flat level, called giáo họ).
    id: "hoa",
    saintName: "Anna",
    name: "Đỗ Thị Hoà",
    fullName: "Anna Đỗ Thị Hoà",
    born: "22/09/2014",
    age: 11,
    parishUnitL1Id: "bt-gh-phero",
    parishUnitL2Id: null,
    phone: "0977 555 444",
    username: "hoa.do",
    father: "Giuse Đỗ Văn Toàn",
    mother: "Maria Phan Thị Kim",
    holding: 0,
    membership: "active",
  },
  {
    // Vĩnh Long (design §2, row 4: both levels, tổ numbered across the
    // whole parish rather than within each giáo họ).
    id: "tuan",
    saintName: "Phêrô",
    name: "Lý Anh Tuấn",
    fullName: "Phêrô Lý Anh Tuấn",
    born: "30/11/2013",
    age: 12,
    parishUnitL1Id: "vl-gh-anna",
    parishUnitL2Id: "vl-to-3",
    phone: "0933 777 888",
    username: "tuan.ly",
    father: "Giuse Lý Văn Phong",
    mother: "Anna Trần Thị Xuân",
    holding: 2,
    membership: "active",
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
  {
    // The manager log for Maria Nguyễn Thị Lan (quan-tri/quan-ly-vien/lan)
    // already narrates this handover — "Cho Maria Vũ Khánh Linh mượn Đất
    // Rừng Phương Nam", 05/08 10:15. This is that loan, on the third copy.
    bookSlug: "dat-rung-phuong-nam",
    code: "DT-0201",
    readerId: "linh",
    borrowedOn: "05/08",
    dueOn: "19/08",
    status: "onloan",
    daysLeft: 11,
  },
];

/**
 * Copies currently in the `lost` state (§7.1) — the data behind the
 * lost-copies view on the manager's Sách list. "Báo mất" appears three times
 * in the built interface; this is what feeds the screen that finally gives
 * `lost → available` and `lost → retired` somewhere to happen.
 */
export type LostCopy = {
  bookSlug: string;
  code: string;
  /** Who was holding the copy when it was reported lost. */
  borrower: string;
  reportedOn: string;
};

export const lostCopies: LostCopy[] = [
  {
    bookSlug: "de-men-phieu-luu-ky",
    code: "DT-0142",
    borrower: "Maria Vũ Khánh Linh",
    reportedOn: "22/07",
  },
  {
    bookSlug: "dat-rung-phuong-nam",
    code: "DT-0202",
    borrower: "Anna Phạm Thu Hà",
    reportedOn: "30/06",
  },
  // Not DT-0112 (Những Tấm Lòng Cao Cả) — that copy is already `held`,
  // reserved for Anna Phạm Thu Hà to collect (see the borrow-request queue
  // and /ho-so/thong-bao). A copy cannot be simultaneously held and lost
  // (INV-2), so the third lost example lives on a title with no other claim
  // on its one copy instead.
  {
    bookSlug: "chuyen-con-meo-day-hai-au-bay",
    code: "DT-0118",
    borrower: "Gioan Bùi Đức Thắng",
    reportedOn: "12/06",
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
 * The name `ShelfHeader` shows on the shelf pages that are **not wired yet**.
 *
 * U2 Task 5 removed that component's `reader = "Giuse Trần Minh"` default,
 * because a default is what let every page in the app render real books under
 * a stranger's name without anybody deciding to. The eight reader pages that
 * still draw their content from this file need *something*, and the honest
 * something is a fixture named as one — sitting beside the fixture books and
 * fixture loans those pages also render, rather than baked into a shared
 * component where a wired page could pick it up by accident.
 *
 * It is `readers`' own "minh" rather than a fresh string, so the header agrees
 * with the loans, comments and dashboard rows on the same pages; `minh.tran` is
 * also the seeded reader account, so a developer signing in as that account and
 * walking from a wired page to an unwired one does not appear to change person.
 * Each of these call sites disappears as its page is wired to `Viewer`.
 */
export const fixtureViewerName = "Giuse Trần Minh";

/**
 * A reader's offer to give books to the shelf (§3 of the refinements design;
 * BR §7.7, §16.2, §16.3). This is not provenance — provenance lives on
 * `book_copies` once a manager actually catalogues what was handed over.
 *
 * Carries every status, not only `pending`: the manager's queue
 * (`donationQueue`, below) is pending-only, but BR §16.2 also requires the
 * reader's own donation list to show where each offer stands — pending,
 * received, or declined — so the fixture needs decided examples too.
 */
export type Donation = {
  id: string;
  readerId: string;
  description: string;
  estimatedCount?: number;
  hasPhoto?: boolean;
  submittedOn: string;
  status: "pending" | "received" | "declined";
  decidedOn?: string;
  /** Required by the fixture data whenever `status` is `declined` (BR §5.4). */
  decisionNote?: string;
};

export const donations: Donation[] = [
  {
    id: "linh-01",
    readerId: "linh",
    description:
      "Em có 5 cuốn truyện tranh và 2 cuốn Dế Mèn, sách còn mới vì em đọc ít.",
    estimatedCount: 7,
    hasPhoto: true,
    submittedOn: "05/08",
    status: "pending",
  },
  {
    id: "anh-01",
    readerId: "anh",
    description:
      "Nhà em dọn tủ sách cũ, có mấy cuốn Kính Vạn Hoa và mấy cuốn truyện cổ tích, chắc khoảng chục cuốn.",
    estimatedCount: 10,
    hasPhoto: false,
    submittedOn: "03/08",
    status: "pending",
  },
  {
    id: "minh-01",
    readerId: "minh",
    description:
      "Em muốn tặng lại vài cuốn sách khoa học thiếu nhi em đã đọc xong.",
    hasPhoto: true,
    submittedOn: "01/08",
    status: "pending",
  },
  {
    id: "minh-00",
    readerId: "minh",
    description: "Em có 3 cuốn truyện thiếu nhi cũ, còn đọc được.",
    estimatedCount: 3,
    hasPhoto: false,
    submittedOn: "10/07",
    status: "received",
    decidedOn: "12/07",
  },
  {
    id: "minh-decl-01",
    readerId: "minh",
    description: "Em có mấy cuốn sách giáo khoa cũ không dùng nữa.",
    hasPhoto: false,
    submittedOn: "18/06",
    status: "declined",
    decidedOn: "20/06",
    decisionNote: "Tủ sách chỉ nhận truyện, không nhận sách giáo khoa.",
  },
];

/** The manager's donation queue — pending offers only. */
export const donationQueue: Donation[] = donations.filter(
  (d) => d.status === "pending",
);

export function donationsByReader(readerId: string) {
  return donations.filter((d) => d.readerId === readerId);
}

// `coverForTitle` used to live here — cover artwork looked up by matching a
// book's *title* against these eleven fixtures, which is what let a real
// parish's book named the same as a fixture ("Dế Mèn Phiêu Lưu Ký") serve
// `public/covers/de-men-phieu-luu-ky.svg`, captioned "Tủ sách Đồng Tháp", on
// its own public page. Task 12 (2026-08-10 QA remediation) gave `BookCover`
// a `coverUrl` prop read from `books.cover_url` instead and deleted this
// function along with its one caller — the "once a real data layer exists"
// this docstring used to defer to has arrived. The SVGs under
// `public/covers/` are unchanged otherwise and still exist for a future
// caller that wants to seed real artwork from them; only the caption line
// naming Đồng Tháp was removed from each, so a fixture cover that does get
// served again carries no other parish's name.
