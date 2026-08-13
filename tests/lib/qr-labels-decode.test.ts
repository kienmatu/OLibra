import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { afterAll, expect, test } from "vitest";
import { uuidFromPayload } from "../../src/lib/qr";
import {
  buildLabelSheet,
  labelBoxes,
  QR_OFFSET,
  SHEET,
} from "../../src/lib/qr-labels";

/**
 * The end-to-end check: render the sheet, print it at an ordinary office
 * printer's resolution, and read the symbols back with a decoder that knows
 * nothing about how they were drawn.
 *
 * **This test earns its runtime.** While prototyping this feature two real
 * bugs were invisible to review and to every unit test written at the time — a
 * grid whose rows totalled 336mm on a 297mm page, so the top and bottom rows
 * were clipped off the paper, and a fixture generator producing malformed
 * UUIDs from signed 32-bit bitwise arithmetic. Both were silent. Both surfaced
 * the moment a rendered sheet was rasterised and decoded. Geometry assertions
 * alone would have caught only the first.
 *
 * Requires poppler's `pdftoppm`. CI installs it; see `.github/workflows/`.
 */

const DPI = 300;
const PX = DPI / 25.4;
/** White space around the crop — a QR needs a quiet zone to be found. */
const CROP_PAD = 3;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const COPIES = Array.from({ length: SHEET.perPage }, (_, i) => ({
  id: `892219cc-85e8-4d78-af28-5a66e0fc7c${String(i).padStart(2, "0")}`,
  code: `DT-${String(i + 1).padStart(4, "0")}`,
  title: "Totto-chan Bên Cửa Sổ",
}));

function cropQr(png: PNG, xMm: number, yMm: number) {
  const side = Math.round((QR_OFFSET.side + 2 * CROP_PAD) * PX);
  const x0 = Math.round((xMm - CROP_PAD) * PX);
  const y0 = Math.round((yMm - CROP_PAD) * PX);

  const out = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const src = ((y0 + row) * png.width + (x0 + col)) * 4;
      const dst = (row * side + col) * 4;
      out[dst] = png.data[src];
      out[dst + 1] = png.data[src + 1];
      out[dst + 2] = png.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { out, side };
}

test(
  "every printed label decodes back to its own copy id at 300dpi",
  async () => {
    const bytes = await buildLabelSheet(COPIES, "Tủ sách Đồng Tháp");

    const dir = mkdtempSync(path.join(tmpdir(), "olibra-qr-"));
    dirs.push(dir);
    const pdf = path.join(dir, "sheet.pdf");
    writeFileSync(pdf, bytes);
    execFileSync("pdftoppm", [
      "-png",
      "-r",
      String(DPI),
      "-f",
      "1",
      "-l",
      "1",
      pdf,
      path.join(dir, "page"),
    ]);

    const png = PNG.sync.read(readFileSync(path.join(dir, "page-1.png")));
    const boxes = labelBoxes(COPIES.length);

    const decoded = boxes.map((box) => {
      const { out, side } = cropQr(
        png,
        box.x + QR_OFFSET.x,
        box.y + QR_OFFSET.y,
      );
      const result = jsQR(out, side, side);
      return result ? uuidFromPayload(result.data) : null;
    });

    expect(decoded).toEqual(COPIES.map((c) => c.id));
  },
  60_000,
);
