import { getScenario } from "@apple/test-fixtures";
import { describe, expect, it } from "vitest";
import { liveMoment } from "./presentation";

describe("liveMoment", () => {
  it("gives a feed error priority over a retained final snapshot", () => {
    const snapshot = getScenario("mets-win").frames.at(-1)?.snapshot;
    if (!snapshot) throw new Error("Missing final fixture frame");

    const moment = liveMoment("ERROR", snapshot, undefined, "Home run");

    expect(moment).toEqual({
      label: "STANDBY",
      lastEvent: "Live updates are temporarily unavailable. The Apple will try again momentarily.",
    });
    expect(JSON.stringify(moment)).not.toContain("FINAL");
    expect(JSON.stringify(moment)).not.toContain("BETWEEN GAMES");
  });
});
