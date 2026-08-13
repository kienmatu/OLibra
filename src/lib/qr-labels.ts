import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { payloadFor } from "./qr";

/** PDF points per millimetre. Every dimension in this file is millimetres. */
const MM = 72 / 25.4;

/**
 * The sheet, sized to what A4 and US Letter *share* rather than to A4.
 *
 * Letter is 215.9 x 279.4mm — wider than A4 and, decisively, 17.6mm shorter. A
 * sheet that must print correctly on either has 210 x 279.4mm to work with,
 * and 12mm of margin leaves 186 x 255.4mm. Laying the grid out inside that box
 * on an A4 page means nothing falls off the paper whichever the parish loaded,
 * and no volunteer has to know which they loaded.
 *
 * Portability costs a row: 21 labels per page rather than the 24 a
 * Letter-blind layout would fit, so a 400-copy shelf is 20 pages instead of 17.
 * That is the whole trade, stated once, here.
 *
 * Avery L7159 pre-cut stock was measured and rejected — 63.5 x 33.9mm in 3
 * columns of 8 is 190.5mm across and 271.2mm down, both outside the shared box.
 * A die-cut sheet cannot be made paper-size-portable by drawing it smaller,
 * because the perforations do not move.
 */
export const SHEET = {
  pageW: 210,
  pageH: 297,
  safeW: 186,
  safeH: 279.4,
  cols: 3,
  rows: 7,
  perPage: 21,
  labelW: 58,
  labelH: 34,
  gapX: 4,
  cellY: 35,
} as const;

/** The QR's own square, and the label's internal padding. */
const QR_SIDE = 25;
const PAD = 3;

const marginX =
  (SHEET.pageW - (SHEET.cols * SHEET.labelW + (SHEET.cols - 1) * SHEET.gapX)) /
  2;
const marginY =
  (SHEET.pageH - SHEET.safeH) / 2 + (SHEET.safeH - SHEET.rows * SHEET.cellY) / 2;

/** Where the QR sits inside a label, measured from the label's own top-left. */
export const QR_OFFSET = {
  x: PAD,
  y: (SHEET.labelH - QR_SIDE) / 2,
  side: QR_SIDE,
} as const;

/**
 * Where each label goes, in millimetres from the page's top-left.
 *
 * Separated from the drawing so the geometry is testable without producing a
 * PDF, and this is not fastidiousness. The first draft of this layout used one
 * cell pitch for both axes and put 336mm of rows on a 297mm page: invisible in
 * review, silent at run time, and detectable only as unscannable labels on
 * paper after somebody had already printed four hundred of them.
 */
export function labelBoxes(
  count: number,
): { page: number; x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const slot = i % SHEET.perPage;
    return {
      page: Math.floor(i / SHEET.perPage),
      x: marginX + (slot % SHEET.cols) * (SHEET.labelW + SHEET.gapX),
      y: marginY + Math.floor(slot / SHEET.cols) * SHEET.cellY,
    };
  });
}

const HAIRLINE = rgb(0.8, 0.78, 0.75);
const INK = rgb(0.1, 0.09, 0.08);
const MUTED = rgb(0.42, 0.4, 0.38);

/**
 * The QR as filled rectangles, run-length-merging each row.
 *
 * No raster and therefore no DPI: the symbol is as sharp as the printer is,
 * not as sharp as whatever resolution we guessed at. Merging horizontal runs
 * keeps a full page near 4,600 rectangles instead of roughly 12,000, which is
 * the difference between a 90KB file and a slow one.
 *
 * Error correction is **Q** — a quarter of the symbol may be lost. That is the
 * budget a label glued to a children's book needs, and the reason the payload
 * is base64url rather than UUID text: 27 bytes fit version 3 at Q, 36 do not.
 */
function drawQr(
  page: PDFPage,
  payload: string,
  xMm: number,
  yTopMm: number,
  sideMm: number,
): void {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "Q" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const m = sideMm / size;
  const yBottomMm = SHEET.pageH - yTopMm - sideMm;

  for (let row = 0; row < size; row++) {
    let run = 0;
    for (let col = 0; col <= size; col++) {
      const on = col < size && data[row * size + col] === 1;
      if (on) {
        run++;
        continue;
      }
      if (run > 0) {
        page.drawRectangle({
          x: (xMm + (col - run) * m) * MM,
          // PDF's origin is bottom-left; QR rows count downward.
          y: (yBottomMm + sideMm - (row + 1) * m) * MM,
          width: run * m * MM,
          height: m * MM,
          color: rgb(0, 0, 0),
        });
        run = 0;
      }
    }
  }
}

/** Truncate with an ellipsis to fit `maxWidthMm`. */
function fit(
  font: PDFFont,
  text: string,
  size: number,
  maxWidthMm: number,
): string {
  const max = maxWidthMm * MM;
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/**
 * Wrap to at most `maxLines`, ellipsing only the last.
 *
 * Titles wrap rather than truncate: "Totto-chan Bên Cửa Sổ" does not fit one
 * line at this size, and a label reading "Totto-chan Bên Cửa…" has failed at
 * the one job its text half has.
 */
function wrap(
  font: PDFFont,
  text: string,
  size: number,
  maxWidthMm: number,
  maxLines: number,
): string[] {
  const max = maxWidthMm * MM;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= max) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = fit(font, lines[maxLines - 1], size, maxWidthMm);
  }
  return lines.slice(0, maxLines);
}

/**
 * The vendored faces.
 *
 * pdf-lib's fourteen standard fonts are WinAnsi-encoded and cannot render
 * "Dế Mèn Phiêu Lưu Ký" at all, and `next/font` is no help because it emits
 * **woff2**, which fontkit does not read. So Lexend — the same face the
 * interface already uses, per AGENTS.md rule 1 — is committed to the
 * repository under `src/lib/fonts/` and read from disk here.
 *
 * `process.cwd()` rather than a bundler-relative path: the files are traced
 * into the standalone build by `outputFileTracingIncludes` in `next.config.ts`,
 * and the working directory is the app root in both `next dev` and the
 * container. Without that config entry this works locally and throws ENOENT
 * only after deploy.
 */
function fontBytes(file: string): Uint8Array {
  return new Uint8Array(
    readFileSync(path.join(process.cwd(), "src/lib/fonts", file)),
  );
}

export interface SheetCopy {
  id: string;
  code: string;
  title: string;
}

/**
 * The label sheet, as PDF bytes.
 *
 * Built in memory and never written anywhere: the route streams these straight
 * out with `Cache-Control: no-store`, so there is no temporary file to clean up
 * and no cache to invalidate. A 400-copy shelf is 20 pages and comfortably
 * under a megabyte.
 */
export async function buildLabelSheet(
  copies: SheetCopy[],
  shelfName: string,
): Promise<Uint8Array> {
  if (copies.length === 0) {
    throw new Error("buildLabelSheet: nothing selected");
  }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes("Lexend-Regular.ttf"), {
    subset: true,
  });
  const bold = await doc.embedFont(fontBytes("Lexend-SemiBold.ttf"), {
    subset: true,
  });

  const boxes = labelBoxes(copies.length);
  const pageCount = boxes[boxes.length - 1].page + 1;
  const pages = Array.from({ length: pageCount }, () =>
    doc.addPage([SHEET.pageW * MM, SHEET.pageH * MM]),
  );

  copies.forEach((copy, i) => {
    const box = boxes[i];
    const page = pages[box.page];
    const bottom = SHEET.pageH - box.y - SHEET.labelH;

    page.drawRectangle({
      x: box.x * MM,
      y: bottom * MM,
      width: SHEET.labelW * MM,
      height: SHEET.labelH * MM,
      borderColor: HAIRLINE,
      borderWidth: 0.4,
    });

    drawQr(
      page,
      payloadFor(copy.id),
      box.x + QR_OFFSET.x,
      box.y + QR_OFFSET.y,
      QR_OFFSET.side,
    );

    const tx = box.x + PAD + QR_SIDE + 3;
    const tw = SHEET.labelW - (tx - box.x) - PAD;

    page.drawText(copy.code, {
      x: tx * MM,
      y: (bottom + SHEET.labelH - 10) * MM,
      size: 12,
      font: bold,
      color: INK,
    });

    wrap(regular, copy.title, 6.8, tw, 2).forEach((line, n) => {
      page.drawText(line, {
        x: tx * MM,
        y: (bottom + SHEET.labelH - (14.5 + n * 3.4)) * MM,
        size: 6.8,
        font: regular,
        color: INK,
      });
    });

    page.drawText(fit(regular, shelfName, 6, tw), {
      x: tx * MM,
      y: (bottom + 3.5) * MM,
      size: 6,
      font: regular,
      color: MUTED,
    });
  });

  doc.setTitle(`Nhãn QR — ${shelfName}`);
  return doc.save();
}
