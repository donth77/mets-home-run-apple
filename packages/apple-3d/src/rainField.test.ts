import { describe, expect, it } from "vitest";
import { advanceRainField, createRainField, RAIN_CEILING_Y, RAIN_FLOOR_Y, rainSurfaceY } from "./rainField";

describe("3D rain field", () => {
  it("creates deterministic depth-positioned drops and an impact pool", () => {
    const first = createRainField(4, 3);
    const second = createRainField(4, 3);

    expect([...first.positions]).toEqual([...second.positions]);
    expect(first.positions).toHaveLength(24);
    expect(first.speeds).toHaveLength(4);
    expect(first.widths).toHaveLength(4);
    expect(first.ripplePositions).toHaveLength(9);
    expect(first.rippleAges.every((age) => age === Number.POSITIVE_INFINITY)).toBe(true);
    expect([...first.speeds].every((speed) => speed >= 12.5 && speed <= 21)).toBe(true);
  });

  it("moves drops downward, records their ground impact, and recycles them", () => {
    const field = createRainField(1, 2);
    const startingY = field.positions[1];
    advanceRainField(field, 0.02);
    expect(field.positions[1]).toBeLessThan(startingY);

    field.positions[4] = RAIN_FLOOR_Y - 1;
    expect(advanceRainField(field, 0.01)).toBe(1);
    expect(field.positions[1]).toBeGreaterThanOrEqual(RAIN_CEILING_Y);
    expect(field.rippleAges[0]).toBe(0);
    expect(field.ripplePositions[1]).toBeGreaterThan(RAIN_FLOOR_Y);
  });

  it("ages impact ripples independently of new collisions", () => {
    const field = createRainField(1, 1);
    field.positions[4] = RAIN_FLOOR_Y - 1;
    advanceRainField(field, 0.01);
    advanceRainField(field, 0.05);

    expect(field.rippleAges[0]).toBeCloseTo(0.05);
  });

  it("places warning-track impacts just above the grass impacts", () => {
    expect(rainSurfaceY(-3)).toBeGreaterThan(rainSurfaceY(2));
  });
});
