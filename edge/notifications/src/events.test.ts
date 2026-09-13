import type { NormalizedFeedCapture } from "@apple/mlb-live-feed";
import type { NormalizedGameInput, NormalizedPlayEvidence } from "@apple/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifiedNotificationEvents } from "./events";
import { HOME_RUN_NOTIFICATION_TEMPLATES } from "./homeRunCopy";

const createGameCore = () => GameCore.create();

beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});

function play(
  eventKey: string,
  battingTeamId: number,
  batterName: string,
  kind: NormalizedPlayEvidence["kind"] = "HOME_RUN",
  review: NormalizedPlayEvidence["review"] = "NONE",
): NormalizedPlayEvidence {
  return {
    eventKey,
    atBatIndex: Number(eventKey.split("-").at(-1) ?? 1),
    battingTeamId,
    batterName,
    kind,
    complete: true,
    review,
  };
}

function capture(
  plays: readonly NormalizedPlayEvidence[],
  options: { final?: boolean; metsWon?: boolean } = {},
): NormalizedFeedCapture {
  const final = options.final ?? false;
  const metsWon = options.metsWon ?? false;
  const input: NormalizedGameInput = {
    schemaVersion: 1,
    updateMode: "BOOTSTRAP",
    gamePk: 777001,
    gameNumber: 1,
    cursor: "20260903_010000",
    phase: final ? "FINAL" : "LIVE",
    half: final ? "END" : "BOTTOM",
    inning: final ? 9 : 7,
    outs: final ? 3 : 1,
    awayTeamId: 144,
    homeTeamId: 121,
    awayRuns: final ? 4 : 2,
    homeRuns: final ? (metsWon ? 5 : 3) : 3,
    plays,
  };
  return {
    coreInput: input,
    gameSnapshot: {
      schemaVersion: 1,
      gamePk: input.gamePk,
      gameNumber: 1,
      phase: input.phase,
      label: final ? "FINAL" : "BOTTOM 7",
      away: { id: 144, abbreviation: "ATL", name: "Atlanta Braves", runs: input.awayRuns },
      home: { id: 121, abbreviation: "NYM", name: "New York Mets", runs: input.homeRuns },
      inning: input.inning,
      half: input.half,
      outs: input.outs as 0 | 1 | 2 | 3,
      review: "NONE",
      lastEvent: "",
    },
    cursor: input.cursor,
    waitMs: 1_000,
    payloadKind: "FULL_BOOTSTRAP",
    receivedAt: "2026-09-03T01:00:00.000Z",
    rawPlayCount: plays.length,
    changedPlayCount: plays.length,
    replayCandidates: [
      ...plays.map((candidate, index) => ({
        eventKey: candidate.eventKey,
        kind: candidate.kind === "GRAND_SLAM" ? ("GRAND_SLAM" as const) : ("HOME_RUN" as const),
        occurredAt: `2026-09-03T01:0${index}:00.000Z`,
      })),
      ...(final
        ? [{ eventKey: `${input.gamePk}:final`, kind: "FINAL" as const, occurredAt: "2026-09-03T01:09:00.000Z" }]
        : []),
    ],
  };
}

describe("notification event decisions", () => {
  it("uses the canonical core to accept Mets homers and ignore opponent homers", async () => {
    const result = await verifiedNotificationEvents(
      capture([play("777001:play-1", 121, "Francisco Lindor"), play("777001:play-2", 144, "Opponent")]),
      createGameCore,
    );

    expect(result).toMatchObject([
      {
        eventKey: "777001:play-1",
        kind: "HOME_RUN",
        body: "ATL 2, NYM 3 · Bottom 7",
      },
    ]);
    expect(result[0]?.title).toSatisfy((title: string) =>
      HOME_RUN_NOTIFICATION_TEMPLATES.some((template) => template.replace("{player}", "Francisco Lindor") === title),
    );
  });

  it("handles back-to-back homers and a win without dropping queued core events", async () => {
    const result = await verifiedNotificationEvents(
      capture([play("777001:play-7", 121, "Juan Soto"), play("777001:play-8", 121, "Bo Bichette", "GRAND_SLAM")], {
        final: true,
        metsWon: true,
      }),
      createGameCore,
    );

    expect(result.map(({ eventKey, kind }) => ({ eventKey, kind }))).toEqual([
      { eventKey: "777001:play-7", kind: "HOME_RUN" },
      { eventKey: "777001:play-8", kind: "GRAND_SLAM" },
      { eventKey: "777001:final", kind: "METS_WIN" },
    ]);
    expect(result.at(-1)?.title).toBe("Mets win!");
  });

  it("does not notify pending, overturned, losing-final, or consumed events", async () => {
    const pending = play("777001:play-3", 121, "Pending Met", "HOME_RUN", "PENDING");
    const overturned = play("777001:play-4", 121, "Overturned Met", "HOME_RUN", "OVERTURNED");
    const result = await verifiedNotificationEvents(
      capture([pending, overturned], { final: true, metsWon: false }),
      createGameCore,
      new Set([overturned.eventKey]),
    );

    expect(result).toEqual([]);
  });
});
import { GameCore } from "@apple/game-core-wasm";
