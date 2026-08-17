import { describe, expect, it } from "vitest";
import { shouldAutoRotate } from "./print-layout";

const portraitPage = { pageW: 595, pageH: 842 };
const landscapePage = { pageW: 842, pageH: 595 };
const portraitCell = { cellW: 400, cellH: 560 };
const landscapeCell = { cellW: 560, cellH: 400 };

describe("shouldAutoRotate", () => {
  it("rotates a landscape page on a portrait sheet when 1-up and scalable", () => {
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", ...landscapePage, ...portraitCell })
    ).toBe(true);
  });

  it("rotates a portrait page on a landscape sheet", () => {
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", ...portraitPage, ...landscapeCell })
    ).toBe(true);
  });

  it("leaves a page alone when its orientation already matches the cell", () => {
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", ...portraitPage, ...portraitCell })
    ).toBe(false);
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", ...landscapePage, ...landscapeCell })
    ).toBe(false);
  });

  // The two agent guards the preview used to ignore — the actual reported bug.
  it("never rotates under N-up, matching the agent's $sheetFiles.Count -eq 1 guard", () => {
    for (const pagesPerSheet of [2, 4, 6, 9, 16]) {
      expect(
        shouldAutoRotate({ pagesPerSheet, scaleMode: "default", ...landscapePage, ...portraitCell })
      ).toBe(false);
    }
  });

  it('never rotates for noscale, matching the agent\'s $Scale -ne "noscale" guard', () => {
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "noscale", ...landscapePage, ...portraitCell })
    ).toBe(false);
  });

  it("still rotates for the other scalable modes", () => {
    for (const scaleMode of ["default", "fit", "shrink"]) {
      expect(
        shouldAutoRotate({ pagesPerSheet: 1, scaleMode, ...landscapePage, ...portraitCell })
      ).toBe(true);
    }
  });

  it("treats a square page as portrait, so it stays put on a portrait cell", () => {
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", pageW: 500, pageH: 500, ...portraitCell })
    ).toBe(false);
    expect(
      shouldAutoRotate({ pagesPerSheet: 1, scaleMode: "default", pageW: 500, pageH: 500, ...landscapeCell })
    ).toBe(true);
  });
});
