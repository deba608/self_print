import { describe, it, expect } from "vitest";
import { chunk } from "./util";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it("returns one chunk when size exceeds array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
