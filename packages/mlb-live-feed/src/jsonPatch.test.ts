import { describe, expect, it } from "vitest";
import { applyJsonPatch } from "./jsonPatch";

describe("bounded JSON Patch safety", () => {
  it.each(["__proto__", "constructor", "prototype"])("rejects the dangerous %s pointer token", (token) => {
    expect(() => applyJsonPatch({ safe: {} }, [{ op: "add", path: `/safe/${token}/polluted`, value: true }])).toThrow(
      /Unsafe JSON pointer token/,
    );
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("rejects unsafe copy sources as well as destinations", () => {
    expect(() =>
      applyJsonPatch({ safe: { value: 1 } }, [{ op: "copy", from: "/__proto__/value", path: "/safe/copied" }]),
    ).toThrow(/Unsafe JSON pointer token/);
    expect(() =>
      applyJsonPatch({ safe: { value: 1 } }, [{ op: "copy", from: "/safe/value", path: "/constructor/copied" }]),
    ).toThrow(/Unsafe JSON pointer token/);
  });

  it("never traverses inherited properties", () => {
    expect(() => applyJsonPatch({ safe: {} }, [{ op: "copy", from: "/toString", path: "/safe/copied" }])).toThrow(
      /Patch source is missing/,
    );
  });
});
