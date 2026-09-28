/** @vitest-environment happy-dom */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import postseason2024 from "../../../firmware/fixtures/mlb/postseason_2024.json";
import standing2024 from "../../../firmware/fixtures/mlb/team_standing_2024.json";
import standing2026 from "../../../firmware/fixtures/mlb/team_standing_2026.json";
import { useMetsSeason } from "./useMetsSeason";

type Answer = Record<string, unknown>;

function scheduleWith(games: Answer[]) {
  return { dates: games.map((game) => ({ date: String(game.gameDate).slice(0, 10), games: [game] })) };
}

function scheduleGame(gamePk: number, gameDate: string, abstractGameState: string, gameType = "R"): Answer {
  return {
    gamePk,
    gameNumber: 1,
    gameDate,
    gameType,
    status: { abstractGameState, detailedState: abstractGameState === "Final" ? "Final" : "Scheduled" },
    teams: {
      away: { team: { id: 121, abbreviation: "NYM", name: "New York Mets" } },
      home: { team: { id: 120, abbreviation: "WSH", name: "Washington Nationals" } },
    },
  };
}

/** Answers each MLB request by path; the season check asks through the site's relay. */
function answerMlb(answers: { schedule: Answer; standing?: Answer; postseason?: Answer }) {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString(), "https://metsapple.com");
      requested.push(`${url.pathname}${url.search}`);
      const body = url.pathname.endsWith("/teams/121")
        ? answers.standing
        : url.searchParams.get("gameType")
          ? answers.postseason
          : answers.schedule;
      return Response.json(body ?? {});
    }),
  );
  return requested;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the Mets' season", () => {
  it("is over after the 2026 finale: nothing this week and out of the race", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T21:30:00Z"), toFake: ["Date"] });
    const requested = answerMlb({
      schedule: scheduleWith([scheduleGame(822679, "2026-09-27T17:05:00Z", "Final")]),
      standing: standing2026,
    });
    const { result } = renderHook(() => useMetsSeason(false, true));

    await waitFor(() => expect(result.current.status).toBe("READY"));
    expect(result.current).toMatchObject({ seasonOver: true, gameThisWeek: false });
    expect(requested[0]).toContain(
      "/api/mlb/api/v1/schedule?sportId=1&teamId=121&startDate=2026-09-26&endDate=2026-10-04",
    );
    expect(requested[1]).toContain("/api/mlb/api/v1/teams/121?season=2026&hydrate=standings");
  });

  it("goes on while a clinched club waits for its next round, and ends when it is knocked out", async () => {
    vi.useFakeTimers({ now: new Date("2024-10-22T15:00:00Z"), toFake: ["Date"] });
    answerMlb({ schedule: scheduleWith([]), standing: standing2024, postseason: postseason2024 });
    const lost = renderHook(() => useMetsSeason(false, true));
    await waitFor(() => expect(lost.result.current.status).toBe("READY"));
    expect(lost.result.current.seasonOver).toBe(true);
    lost.unmount();

    const throughNlds = { dates: postseason2024.dates.slice(0, 7) };
    answerMlb({ schedule: scheduleWith([]), standing: standing2024, postseason: throughNlds });
    const alive = renderHook(() => useMetsSeason(false, true));
    await waitFor(() => expect(alive.result.current.status).toBe("READY"));
    expect(alive.result.current.seasonOver).toBe(false);
  });

  it("comes back the week before the first spring training game", async () => {
    vi.useFakeTimers({ now: new Date("2027-02-14T15:00:00Z"), toFake: ["Date"] });
    const requested = answerMlb({
      schedule: scheduleWith([scheduleGame(868574, "2027-02-19T08:33:00Z", "Preview", "S")]),
    });
    const { result } = renderHook(() => useMetsSeason(true, true));

    await waitFor(() => expect(result.current.status).toBe("READY"));
    expect(result.current).toMatchObject({ seasonOver: false, gameThisWeek: true });
    expect(requested).toHaveLength(1);
  });

  it("stays between seasons while nothing is within the week", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-10T15:00:00Z"), toFake: ["Date"] });
    const requested = answerMlb({ schedule: scheduleWith([]) });
    const { result } = renderHook(() => useMetsSeason(true, true));

    await waitFor(() => expect(result.current.status).toBe("READY"));
    expect(result.current.seasonOver).toBe(true);
    // Between seasons the standing is never asked for.
    expect(requested).toHaveLength(1);
  });

  it("carries on as in season when MLB cannot be reached", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T21:30:00Z"), toFake: ["Date"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const { result } = renderHook(() => useMetsSeason(false, true));

    await waitFor(() => expect(result.current.status).toBe("READY"));
    expect(result.current.seasonOver).toBe(false);
  });
});
