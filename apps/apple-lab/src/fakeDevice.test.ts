import { describe, expect, it } from "vitest";
import { createRecordedDiagnosticEvent, eventsForFilter, fakeDeviceTimeline } from "./fakeDevice";

describe("Apple Lab fake device", () => {
  it("provides significant home-run and Mets-win events without pitch noise", () => {
    expect(fakeDeviceTimeline.some((event) => event.kind === "home-run")).toBe(true);
    expect(fakeDeviceTimeline.some((event) => event.kind === "mets-win")).toBe(true);
    expect(fakeDeviceTimeline.some((event) => event.title.toLowerCase().startsWith("pitch"))).toBe(false);
  });

  it("filters the live timeline by its source category", () => {
    const appleEvents = eventsForFilter(fakeDeviceTimeline, "apple");
    expect(appleEvents.length).toBeGreaterThan(0);
    expect(appleEvents.every((event) => event.category === "apple")).toBe(true);
  });

  it("labels service actions as recording-only diagnostics", () => {
    const event = createRecordedDiagnosticEvent("Display test recorded", "2026-08-27T12:00:00.000Z");
    expect(event.kind).toBe("diagnostic");
    expect(event.result).toBe("recorded");
    expect(event.detail).toContain("No physical output");
  });
});
