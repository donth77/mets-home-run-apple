import { describe, expect, it } from "vitest";
import { delayWidgetLabel, isRainDelayPresentation } from "./delayPresentation";

describe("delay presentation", () => {
  it("reserves the rain presentation for an explicit rain delay", () => {
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "RAIN DELAY" })).toBe(true);
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "Delayed" })).toBe(false);
    expect(isRainDelayPresentation({ phase: "DELAYED", label: "Suspended: Rain" })).toBe(false);
  });

  it("uses a simple bottom-widget label for every other delay", () => {
    expect(delayWidgetLabel({ phase: "DELAYED", label: "RAIN DELAY" })).toBe("RAIN DELAY");
    expect(delayWidgetLabel({ phase: "DELAYED", label: "Delayed: Power" })).toBe("DELAY");
  });
});
