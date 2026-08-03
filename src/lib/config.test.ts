import { describe, it, expect } from "vitest";
import { CART_ABANDON_MINUTES } from "./config";

describe("CART_ABANDON_MINUTES", () => {
  it("defaults to 1440 minutes (24h) when env var unset", () => {
    expect(CART_ABANDON_MINUTES).toBe(1440);
  });
});
