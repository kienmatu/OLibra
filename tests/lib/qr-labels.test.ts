import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildLabelSheet, labelBoxes, SHEET } from "../../src/lib/qr-labels";

/**
 * Page count by parsing the produced file, not by grepping its bytes.
 *
 * pdf-lib writes compressed object streams, so `/Type /Page` does not appear as
 * plain text in the output and a regex over the buffer silently finds nothing —
 * which is a test that passes for the wrong reason the moment it is written the
 * other way round.
 */
async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

const MM = 72 / 25.4;

/** The A4-and-Letter intersection, restated here so the test does not read it from the code it checks. */
const SAFE_W = 186;
const SAFE_H = 255.4;
const A4_W = 210;
const A4_H = 297;

const copyAt = (i: number) => ({
  id: `892219cc-85e8-4d78-af28-5a66e0fc7c${String(i % 100).padStart(2, "0")}`,
  code: `DT-${String(i + 1).padStart(4, "0")}`,
  title: "Totto-chan Bên Cửa Sổ",
});

describe("SHEET", () => {
  it("fits the A4-and-Letter intersection", () => {
    const across = SHEET.cols * SHEET.labelW + (SHEET.cols - 1) * SHEET.gapX;
    expect(across).toBeLessThanOrEqual(SAFE_W);
    expect(SHEET.rows * SHEET.cellY).toBeLessThanOrEqual(SAFE_H);
  });

  it("agrees with itself about how many labels a page holds", () => {
    expect(SHEET.perPage).toBe(SHEET.cols * SHEET.rows);
  });

  it("leaves room for the label inside its own cell", () => {
    expect(SHEET.cellY).toBeGreaterThanOrEqual(SHEET.labelH);
  });
});

describe("labelBoxes", () => {
  const left = (A4_W - SAFE_W) / 2;
  const top = (A4_H - SAFE_H) / 2;

  const insideSafeBox = (b: { x: number; y: number }) =>
    b.x >= left - 0.01 &&
    b.x + SHEET.labelW <= A4_W - left + 0.01 &&
    b.y >= top - 0.01 &&
    b.y + SHEET.labelH <= A4_H - top + 0.01;

  /**
   * The assertion that would have caught the prototype's 336mm-of-rows bug, and
   * it is against the *shared* box rather than the A4 media box on purpose: an
   * A4-only version of this test passes a sheet that overruns US Letter, which
   * is precisely the failure it exists to prevent.
   *
   * 22 is the off-by-one that starts page two.
   */
  it.each([1, 2, SHEET.perPage, SHEET.perPage + 1, 100, 400])(
    "keeps every one of %i labels inside the shared safe box",
    (count) => {
      const boxes = labelBoxes(count);
      expect(boxes).toHaveLength(count);
      expect(boxes.filter((b) => !insideSafeBox(b))).toEqual([]);
    },
  );

  it("starts a new page after a full one, at the same place", () => {
    const boxes = labelBoxes(SHEET.perPage + 1);
    expect(boxes[SHEET.perPage - 1].page).toBe(0);
    expect(boxes[SHEET.perPage].page).toBe(1);
    expect(boxes[SHEET.perPage].x).toBeCloseTo(boxes[0].x, 6);
    expect(boxes[SHEET.perPage].y).toBeCloseTo(boxes[0].y, 6);
  });

  it("fills left to right, then top to bottom", () => {
    const boxes = labelBoxes(SHEET.cols + 1);
    expect(boxes[1].y).toBeCloseTo(boxes[0].y, 6);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[SHEET.cols].x).toBeCloseTo(boxes[0].x, 6);
    expect(boxes[SHEET.cols].y).toBeGreaterThan(boxes[0].y);
  });

  it("never overlaps two labels on a page", () => {
    const boxes = labelBoxes(SHEET.perPage);
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const overlapX =
          boxes[a].x < boxes[b].x + SHEET.labelW &&
          boxes[b].x < boxes[a].x + SHEET.labelW;
        const overlapY =
          boxes[a].y < boxes[b].y + SHEET.labelH &&
          boxes[b].y < boxes[a].y + SHEET.labelH;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});

describe("buildLabelSheet", () => {
  it("produces a PDF", async () => {
    const bytes = await buildLabelSheet([copyAt(0)], "Tủ sách Đồng Tháp");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("puts a full sheet on one page and one more on a second", async () => {
    const full = Array.from({ length: SHEET.perPage }, (_, i) => copyAt(i));
    expect(
      await pageCountOf(await buildLabelSheet(full, "Tủ sách Đồng Tháp")),
    ).toBe(1);

    const overflow = [...full, copyAt(SHEET.perPage)];
    expect(
      await pageCountOf(await buildLabelSheet(overflow, "Tủ sách Đồng Tháp")),
    ).toBe(2);
  });

  it("emits A4 pages", async () => {
    const doc = await PDFDocument.load(
      await buildLabelSheet([copyAt(0)], "Tủ sách Đồng Tháp"),
    );
    const { width, height } = doc.getPage(0).getSize();
    expect(width / MM).toBeCloseTo(210, 1);
    expect(height / MM).toBeCloseTo(297, 1);
  });

  it("renders Vietnamese titles without throwing on encoding", async () => {
    const bytes = await buildLabelSheet(
      [
        { ...copyAt(0), title: "Dế Mèn Phiêu Lưu Ký" },
        { ...copyAt(1), title: "Đất Rừng Phương Nam" },
        { ...copyAt(2), title: "Hoàng Tử Bé" },
      ],
      "Tủ sách Đồng Tháp",
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("refuses an empty selection", async () => {
    await expect(buildLabelSheet([], "Tủ sách Đồng Tháp")).rejects.toThrow();
  });
});
