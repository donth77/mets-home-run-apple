// Live contract check for the browser feed adapter. It is skipped unless
// MLB_CONTRACT_LIVE=1, because it reaches the real MLB Stats API; the weekly
// "MLB API contract" workflow runs it through firmware/tools/mlb_contract_check.py.

import { describe, expect, it } from "vitest";
import { MlbRecordingClient } from "./client";
import { easternDate, fetchMetsScheduleRange } from "./schedule";

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const live = environment?.MLB_CONTRACT_LIVE === "1";

describe.skipIf(!live)("MLB API contract (live)", () => {
  it("bootstraps the most recent completed Mets game through the browser adapter", async () => {
    const today = easternDate();
    const start = new Date(Date.parse(`${today}T12:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
    const games = await fetchMetsScheduleRange(start, today);
    expect(games.length).toBeGreaterThan(0);
    const finals = games.filter((game) => game.abstractState.toUpperCase() === "FINAL");
    expect(finals.length).toBeGreaterThan(0);
    const game = finals.reduce((latest, candidate) => (candidate.gameDate > latest.gameDate ? candidate : latest));

    const client = new MlbRecordingClient();
    const first = await client.poll(game);
    expect(first.payloadKind).toBe("FULL_BOOTSTRAP");
    expect(first.capture).toBeDefined();
    const snapshot = first.capture?.gameSnapshot;
    expect(snapshot?.gamePk).toBe(game.gamePk);
    expect(snapshot?.phase).toBe("FINAL");
    expect(snapshot?.away.id).toBeGreaterThan(0);
    expect(snapshot?.home.id).toBeGreaterThan(0);
    expect(first.capture?.rawPlayCount ?? 0).toBeGreaterThan(20);
    expect(first.cursor).toMatch(/^\d{8}_\d{6}$/);

    // The diff-patch path must still answer for a completed game.
    const second = await client.poll(game);
    expect(["NO_CHANGE", "DIFF_PATCH", "FULL_DIFF_RESPONSE", "FULL_FALLBACK"]).toContain(second.payloadKind);
  }, 120_000);
});
