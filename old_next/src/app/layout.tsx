import type { Metadata } from "next";
import { Lexend, Literata } from "next/font/google";
import "./globals.css";

/* Self-hosted at build time by next/font — never fetched from a third-party CDN.
   The vietnamese subset is required: diacritics are not optional here. */
const lexend = Lexend({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-lexend",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["600"],
  variable: "--font-literata",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OLibra — Tủ sách cộng đồng",
  description:
    "Phần mềm quản lý cho những tủ sách nhỏ trong giáo xứ. Cho mượn, nhận trả và giữ tủ sách ngăn nắp.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${lexend.variable} ${literata.variable}`}>
      <body>{children}</body>
    </html>
  );
}
