import { getScenario } from "@apple/test-fixtures";
import { describe, expect, it } from "vitest";
import { appleLabPresentationSnapshot } from "./corePresentation";

describe("Apple Lab core presentation", () => {
  it("turns a grand-slam core event into a presentation state", () => {
    const snapshot = getScenario("live").frames[0].snapshot;
    const presented = appleLabPresentationSnapshot(snapshot, {
      events: [
        {
          type: "CELEBRATION_STARTED",
          celebration: "GRAND_SLAM",
          eventKey: "777686:play-48",
          subject: "Pete Alonso",
        },
      ],
    });

    expect(presented).toMatchObject({ phase: "CELEBRATION", label: "GRAND SLAM!!" });
  });
});
