import { describe, expect, it } from "vitest";
import { delayWidgetLabel, isRainDelayPresentation } from "./delayPresentation";

describe("delay presentation", () => {
  it("reserves the rain presentation for the classifier's RAIN DELAY label", () => {
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "RAIN DELAY" })).toBe(true);
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "Delayed" })).toBe(false);
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "Suspended: Rain" })).toBe(false);
    expect(isRainDelayPresentation({ phase: "LIVE", label: "RAIN DELAY" })).toBe(false);
  });

  it("gives every interruption its own headline", () => {
    expect(delayWidgetLabel({ phase: "DELAYED", label: "RAIN DELAY" })).toBe("RAIN DELAY");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Delayed: Power" })).toBe("DELAY");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Delayed" })).toBe("DELAY");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Suspended: Rain" })).toBe("SUSPENDED");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Postponed" })).toBe("POSTPONED");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Cancelled: Rain" })).toBe("CANCELLED");
    expect(delayWidgetLabel({ phase: "LIVE", label: "LIVE" })).toBe("LIVE");
  });
});
