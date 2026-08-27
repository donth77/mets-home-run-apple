import { describe, expect, it } from "vitest";
import { clampPositionMm } from "./index";

describe("clampPositionMm", () => {
  it("keeps recording motion inside the 50 mm envelope", () => {
    expect(clampPositionMm(-12)).toBe(0);
    expect(clampPositionMm(25.4)).toBe(25);
    expect(clampPositionMm(78)).toBe(50);
    expect(clampPositionMm(Number.NaN)).toBe(0);
  });
});
