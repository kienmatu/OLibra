import { AlertTriangle, Clock, Hand, Lock, type LucideIcon } from "lucide-react";

/**
 * BR §17.7's error pages, as content rather than as markup.
 *
 * "Error pages for 403, 404, expired session, rate limiting, and server failure
 * carry plain-language Vietnamese explanations and a route back to safety."
 * `src/app/loi/page.tsx` has always been the reference sheet showing all four
 * of them side by side; `src/app/not-found.tsx` is the one that was actually
 * routed to.
 *
 * **U1 made the fifth one load-bearing.** Before this slice no page could
 * reach Postgres, so no page could 500 — a server fault was a panel on a sheet
 * nobody was ever sent to. Now six screens run SQL on every render, and until
 * `src/app/error.tsx` existed a fault rendered Next.js's own English default:
 * "This page couldn't load / A server error occurred.", with a black Reload
 * button, in a Vietnamese parish system.
 *
 * The copy lives here so the boundary and the sheet cannot disagree. It was a
 * second version of the same screen that would have gone stale, not the first.
 */
export interface ErrorState {
  /** The label the reference sheet prints above the panel. */
  key: string;
  caption: string;
  icon: LucideIcon;
  ink: string;
  heading: string;
  body: string;
  /** The one action out of it — a button on the sheet, a real control in use. */
  action: string;
}

const FORBIDDEN: ErrorState = {
  key: "403",
  caption: "403 — không có quyền",
  icon: Lock,
  ink: "text-leather",
  heading: "Trang này chỉ dành cho quản lý",
  body: "Tài khoản của em không mở được trang này. Nếu em nghĩ đây là nhầm lẫn, nhắn cho quản lý tủ sách giúp nhé.",
  action: "Về trang của em",
};

const SESSION_EXPIRED: ErrorState = {
  key: "het-phien",
  caption: "Phiên đăng nhập hết hạn",
  icon: Clock,
  ink: "text-leather",
  heading: "Em cần đăng nhập lại",
  body: "Em đã không dùng trang trong một lúc lâu nên tủ sách tự đăng xuất cho an toàn.",
  action: "Đăng nhập lại",
};

const RATE_LIMITED: ErrorState = {
  key: "429",
  caption: "Quá nhiều yêu cầu",
  icon: Hand,
  ink: "text-brick",
  heading: "Chậm lại một chút nhé",
  body: "Em vừa gửi hơi nhiều yêu cầu trong thời gian ngắn. Em chờ khoảng một phút rồi thử lại.",
  action: "Thử lại",
};

/**
 * The one that is reached for real, by `src/app/error.tsx` and
 * `src/app/global-error.tsx`.
 *
 * Exported by name and not merely as a member of the list below, because the
 * boundary must render *this* panel rather than "whichever one is fourth".
 */
export const SERVER_FAULT: ErrorState = {
  key: "500",
  caption: "500 — lỗi máy chủ",
  icon: AlertTriangle,
  ink: "text-brick",
  heading: "Tủ sách đang gặp trục trặc",
  body: "Lỗi từ phía tủ sách, không phải do em. Ban quản trị đã được báo và đang xem.",
  action: "Thử lại",
};

/**
 * All four, in the order the reference sheet shows them.
 *
 * The same objects, not copies of them: `SERVER_FAULT` above is the very
 * element `loi/page.tsx` renders fourth, so editing the sentence a volunteer
 * reads during an outage edits the sheet too, and there is no version of this
 * where the two drift.
 */
export const ERROR_STATES: ErrorState[] = [
  FORBIDDEN,
  SESSION_EXPIRED,
  RATE_LIMITED,
  SERVER_FAULT,
];
