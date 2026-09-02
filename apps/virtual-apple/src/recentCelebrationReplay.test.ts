import type { NormalizedFeedCapture } from "@apple/mlb-live-feed";
import type { GameSnapshot, NormalizedGameInput, NormalizedPlayEvidence } from "@apple/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LiveGameCoreController } from "./liveGameCoreController";
import { buildRecentCelebrationReplay, RECENT_CELEBRATION_REPLAY_WINDOW_MS } from "./recentCelebrationReplay";

const activeControllers: LiveGameCoreController[] = [];

afterEach(() => {
  activeControllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
});

function homeRun(
  eventKey: string,
  batterName: string,
  atBatIndex: number,
  battingTeamId = 121,
): NormalizedPlayEvidence {
  return {
    eventKey,
    atBatIndex,
    battingTeamId,
    batterName,
    kind: "HOME_RUN",
    complete: true,
    review: "NONE",
  };
}

function capture({
  phase = "LIVE",
  plays = [],
  replayCandidates = [],
  awayRuns = 2,
  homeRuns = 3,
}: {
  phase?: GameSnapshot["phase"];
  plays?: readonly NormalizedPlayEvidence[];
  replayCandidates?: NormalizedFeedCapture["replayCandidates"];
  awayRuns?: number;
  homeRuns?: number;
}): NormalizedFeedCapture {
  const coreInput: NormalizedGameInput = {
    schemaVersion: 1,
    updateMode: "BOOTSTRAP",
    gamePk: 824560,
    gameNumber: 1,
    cursor: "20260827_190500",
    phase,
    half: phase === "FINAL" ? "END" : "BOTTOM",
    inning: 9,
    outs: phase === "FINAL" ? 3 : 1,
    awayTeamId: 144,
    homeTeamId: 121,
    awayRuns,
    homeRuns,
    plays,
  };
  const gameSnapshot: GameSnapshot = {
    schemaVersion: 1,
    gamePk: coreInput.gamePk,
    gameNumber: coreInput.gameNumber,
    phase,
    label: phase === "FINAL" ? "FINAL" : "LIVE",
    away: { id: 144, abbreviation: "ATL", name: "Atlanta Braves", runs: awayRuns },
    home: { id: 121, abbreviation: "NYM", name: "New York Mets", runs: homeRuns },
    inning: coreInput.inning,
    half: coreInput.half,
    outs: coreInput.outs as 0 | 1 | 2 | 3,
    review: "NONE",
    lastEvent: phase === "FINAL" ? "Final" : "Live game",
  };
  return {
    coreInput,
    gameSnapshot,
    cursor: coreInput.cursor,
    waitMs: 10_000,
    payloadKind: "FULL_BOOTSTRAP",
    receivedAt: "2026-08-27T19:05:00.000Z",
    rawPlayCount: plays.length,
    changedPlayCount: plays.length,
    replayCandidates,
  };
}

async function controller() {
  const instance = await LiveGameCoreController.create();
  activeControllers.push(instance);
  return instance;
}

describe("recent Virtual Apple celebration replay", () => {
  it("replays a fresh home run from the beginning while seeding older history", async () => {
    const oldKey = "824560:old-home-run";
    const freshKey = "824560:fresh-home-run";
    const feedCapture = capture({
      plays: [homeRun(oldKey, "Older hitter", 40), homeRun(freshKey, "Francisco Lindor", 41)],
      replayCandidates: [
        { eventKey: oldKey, kind: "HOME_RUN", occurredAt: "2026-08-27T18:50:00.000Z" },
        { eventKey: freshKey, kind: "HOME_RUN", occurredAt: "2026-08-27T19:03:00.000Z" },
      ],
    });
    const plan = buildRecentCelebrationReplay(feedCapture, Date.parse("2026-08-27T19:05:00.000Z"));

    expect(plan?.bootstrapInput.plays.map(({ eventKey }) => eventKey)).toEqual([oldKey]);
    expect(plan?.replayInput.plays.map(({ eventKey }) => eventKey)).toEqual([freshKey]);

    const virtualCore = await controller();
    expect(virtualCore.ingest(plan?.bootstrapInput as NormalizedGameInput, 0).celebration).toBeUndefined();
    expect(virtualCore.ingest(plan?.replayInput as NormalizedGameInput, 1).celebration).toEqual({
      eventKey: freshKey,
      kind: "HOME_RUN",
      subject: "Francisco Lindor",
    });
    expect(virtualCore.tick(2_001).targetPositionMm).toBe(50);

    const physicalStyleCore = await controller();
    expect(physicalStyleCore.ingest(feedCapture.coreInput, 0).celebration).toBeUndefined();
  });

  it("does not replay an event after the five-minute freshness window", () => {
    const eventKey = "824560:expired-home-run";
    const occurredAtMs = Date.parse("2026-08-27T19:00:00.000Z");
    const feedCapture = capture({
      plays: [homeRun(eventKey, "Juan Soto", 41)],
      replayCandidates: [{ eventKey, kind: "HOME_RUN", occurredAt: new Date(occurredAtMs).toISOString() }],
    });

    expect(
      buildRecentCelebrationReplay(feedCapture, occurredAtMs + RECENT_CELEBRATION_REPLAY_WINDOW_MS + 1),
    ).toBeUndefined();
  });

  it("does not replay an event twice during one page session", () => {
    const eventKey = "824560:already-replayed";
    const feedCapture = capture({
      plays: [homeRun(eventKey, "Juan Soto", 41)],
      replayCandidates: [{ eventKey, kind: "HOME_RUN", occurredAt: "2026-08-27T19:04:00.000Z" }],
    });

    expect(
      buildRecentCelebrationReplay(feedCapture, Date.parse("2026-08-27T19:05:00.000Z"), new Set([eventKey])),
    ).toBeUndefined();
  });

  it("replays a recent final transition only when the shared core confirms a Mets win", async () => {
    const eventKey = "824560:final";
    const winningCapture = capture({
      phase: "FINAL",
      awayRuns: 2,
      homeRuns: 3,
      replayCandidates: [{ eventKey, kind: "FINAL", occurredAt: "2026-08-27T19:04:30.000Z" }],
    });
    const winningPlan = buildRecentCelebrationReplay(winningCapture, Date.parse("2026-08-27T19:05:00.000Z"));
    expect(winningPlan?.bootstrapInput.phase).toBe("LIVE");

    const winningCore = await controller();
    winningCore.ingest(winningPlan?.bootstrapInput as NormalizedGameInput, 0);
    expect(winningCore.ingest(winningPlan?.replayInput as NormalizedGameInput, 1).celebration).toEqual({
      eventKey,
      kind: "METS_WIN",
      subject: "Mets Win!",
    });

    const losingCapture = capture({
      phase: "FINAL",
      awayRuns: 4,
      homeRuns: 3,
      replayCandidates: [{ eventKey, kind: "FINAL", occurredAt: "2026-08-27T19:04:30.000Z" }],
    });
    const losingPlan = buildRecentCelebrationReplay(losingCapture, Date.parse("2026-08-27T19:05:00.000Z"));
    const losingCore = await controller();
    losingCore.ingest(losingPlan?.bootstrapInput as NormalizedGameInput, 0);
    expect(losingCore.ingest(losingPlan?.replayInput as NormalizedGameInput, 1).celebration).toBeUndefined();
  });
});
