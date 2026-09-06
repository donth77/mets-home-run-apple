import { GameCore } from "@apple/game-core-wasm";
import { GameStateProjector } from "@apple/game-state-wasm";
import { describe, expect, it, vi } from "vitest";
import { applyJsonPatch, fetchMetsSchedule, fetchMlbHistoricalGameIndex, MlbRecordingClient } from "./index";

function play({
  atBatIndex,
  balls = 0,
  batterId = 101,
  batterName,
  endTime,
  halfInning,
  inning = 6,
  isComplete = true,
  eventType = "single",
  playEventDescription,
  rbi = 0,
  resultDescription,
  reviewDetails,
  strikes = 0,
}: {
  atBatIndex: number;
  balls?: number;
  batterId?: number;
  batterName?: string;
  endTime?: string;
  halfInning: "top" | "bottom";
  inning?: number;
  isComplete?: boolean;
  eventType?: string;
  playEventDescription?: string;
  rbi?: number;
  resultDescription?: string;
  reviewDetails?: Record<string, unknown>;
  strikes?: number;
}) {
  return {
    result: { eventType, description: resultDescription ?? `${eventType} description`, rbi },
    about: { atBatIndex, halfInning, inning, isComplete, ...(endTime ? { endTime } : {}) },
    count: { balls, strikes },
    matchup: {
      batter: { id: batterId, fullName: batterName ?? (halfInning === "bottom" ? "Juan Soto" : "Opponent") },
      pitcher: { id: 202, fullName: "Pitcher" },
    },
    playEvents: [
      {
        playId: `play-${atBatIndex}`,
        ...(playEventDescription ? { details: { description: playEventDescription } } : {}),
      },
    ],
    ...(reviewDetails ? { reviewDetails } : {}),
  };
}

function feed(
  cursor: string,
  plays: readonly unknown[],
  status = "In Progress",
  linescoreOverrides: Record<string, unknown> = {},
  statusOverrides: Record<string, unknown> = {},
) {
  const currentPlay = plays.at(-1);
  return {
    gamePk: 777001,
    metaData: { timeStamp: cursor, wait: 10 },
    gameData: {
      datetime: { dateTime: "2026-08-27T23:10:00Z" },
      venue: { name: "Citi Field" },
      status: {
        abstractGameState: status === "Final" ? "Final" : "Live",
        detailedState: status,
        ...statusOverrides,
      },
      teams: {
        away: { id: 144, abbreviation: "ATL", teamName: "Braves" },
        home: { id: 121, abbreviation: "NYM", teamName: "Mets" },
      },
    },
    liveData: {
      linescore: {
        currentInning: 6,
        inningHalf: "Bottom",
        outs: 1,
        teams: {
          away: { runs: 2, hits: 5, errors: 0 },
          home: { runs: 3, hits: 7, errors: 0 },
        },
        offense: {},
        innings: [{ num: 1, away: { runs: 0 }, home: { runs: 0 } }],
        ...linescoreOverrides,
      },
      boxscore: {
        teams: {
          away: {
            players: {
              ID202: { stats: { pitching: { numberOfPitches: 74 } } },
            },
          },
          home: {
            players: {
              ID101: { stats: { batting: { atBats: 2, hits: 1, homeRuns: 0 } } },
            },
          },
        },
      },
      plays: { allPlays: plays, currentPlay },
    },
  };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("MLB recording transport", () => {
  it("keeps a historical replay identical through the C++ game-state projector", async () => {
    const firstPlay = play({ atBatIndex: 40, halfInning: "bottom", eventType: "single" });
    const homeRun = play({
      atBatIndex: 41,
      batterName: "Francisco Lindor",
      eventType: "home_run",
      halfInning: "bottom",
      resultDescription: "Francisco Lindor homers on a fly ball to right field.",
    });
    const frames = [
      feed("20260827_190000", [firstPlay], "In Progress"),
      feed("20260827_190010", [firstPlay, homeRun], "In Progress", {
        teams: {
          away: { runs: 2, hits: 5, errors: 0 },
          home: { runs: 4, hits: 8, errors: 0 },
        },
      }),
      feed("20260827_220000", [firstPlay, homeRun], "Final", {
        currentInning: 9,
        inningHalf: "Bottom",
        inningState: "End",
        outs: 3,
        teams: {
          away: { runs: 2, hits: 7, errors: 0 },
          home: { runs: 4, hits: 9, errors: 0 },
        },
      }),
    ];
    const timecodes = ["20260827_190000", "20260827_190010", "20260827_220000"];
    const fetcher = () =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(frames[0]))
        .mockResolvedValueOnce(response(frames[1]))
        .mockResolvedValueOnce(response(frames[2]));
    const now = () => new Date("2026-08-27T22:00:30Z");
    const established = new MlbRecordingClient(fetcher(), now);
    const stateProjector = await GameStateProjector.create();
    const cpp = new MlbRecordingClient(fetcher(), now, (canonical) => stateProjector.project(canonical));

    try {
      for (const timecode of timecodes) {
        const expected = await established.loadTimecode({ gamePk: 777001, gameNumber: 1 }, timecode);
        const actual = await cpp.loadTimecode({ gamePk: 777001, gameNumber: 1 }, timecode);
        expect(actual).toStrictEqual(expected);
      }
    } finally {
      stateProjector.dispose();
    }
  });

  it("discovers both games in a doubleheader without merging their identities", async () => {
    const scheduledGames = [1, 2].map((gameNumber) => ({
      gamePk: 777000 + gameNumber,
      gameNumber,
      gameDate: `2026-08-27T${gameNumber === 1 ? "17" : "23"}:10:00Z`,
      status: { detailedState: "Scheduled" },
      venue: { name: "Citi Field" },
      teams: {
        away: { team: { id: 144, abbreviation: "ATL", name: "Atlanta Braves" } },
        home: { team: { id: 121, abbreviation: "NYM", name: "New York Mets" } },
      },
    }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ dates: [{ games: scheduledGames }] }));
    const games = await fetchMetsSchedule("2026-08-27", fetcher);
    expect(games.map(({ gamePk, gameNumber }) => [gamePk, gameNumber])).toEqual([
      [777001, 1],
      [777002, 2],
    ]);
    expect(games.map(({ venue }) => venue)).toEqual(["Citi Field", "Citi Field"]);
  });

  it("bootstraps history and emits only new or changed play evidence afterward", async () => {
    const oldPlay = play({
      atBatIndex: 1,
      endTime: "2026-08-27T18:59:50.000Z",
      halfInning: "bottom",
      eventType: "home_run",
    });
    const newPlay = play({
      atBatIndex: 2,
      endTime: "2026-08-27T19:00:05.000Z",
      halfInning: "bottom",
      eventType: "home_run",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feed("20260827_190000", [oldPlay])))
      .mockResolvedValueOnce(response(feed("20260827_190010", [oldPlay, newPlay])));
    const client = new MlbRecordingClient(fetcher, () => new Date("2026-08-27T23:00:00Z"));

    const bootstrap = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(bootstrap.capture?.coreInput.updateMode).toBe("BOOTSTRAP");
    expect(bootstrap.capture?.changedPlayCount).toBe(1);
    expect(bootstrap.capture?.replayCandidates).toEqual([
      {
        eventKey: "777001:play-1",
        kind: "HOME_RUN",
        occurredAt: "2026-08-27T18:59:50.000Z",
      },
    ]);
    expect(bootstrap.capture?.gameSnapshot.atBat).toMatchObject({ batterLine: "1–2", pitchCount: 74 });
    expect(bootstrap.capture?.gameSnapshot).toMatchObject({
      scheduledStart: "2026-08-27T23:10:00Z",
      venue: "Citi Field",
    });
    expect(bootstrap.capture?.coreInput).toMatchObject({
      gamePk: bootstrap.capture?.gameSnapshot.gamePk,
      gameNumber: bootstrap.capture?.gameSnapshot.gameNumber,
      phase: bootstrap.capture?.gameSnapshot.phase,
      inning: bootstrap.capture?.gameSnapshot.inning,
      half: bootstrap.capture?.gameSnapshot.half,
      awayTeamId: bootstrap.capture?.gameSnapshot.away.id,
      homeTeamId: bootstrap.capture?.gameSnapshot.home.id,
      awayRuns: bootstrap.capture?.gameSnapshot.away.runs,
      homeRuns: bootstrap.capture?.gameSnapshot.home.runs,
    });
    const incremental = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(incremental.capture?.coreInput.updateMode).toBe("INCREMENTAL");
    expect(incremental.capture?.coreInput.plays.map(({ eventKey }) => eventKey)).toEqual(["777001:play-2"]);
    expect(incremental.capture?.replayCandidates).toEqual([]);
  });

  it("exposes a timestamped final candidate when a new client opens a completed game", async () => {
    const finalPlay = play({
      atBatIndex: 41,
      endTime: "2026-08-27T22:00:00.000Z",
      halfInning: "bottom",
      inning: 9,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        feed("20260827_220005", [finalPlay], "Final", {
          currentInning: 9,
          inningHalf: "Bottom",
          outs: 3,
        }),
      ),
    );
    const client = new MlbRecordingClient(fetcher, () => new Date("2026-08-27T22:00:30Z"));

    const bootstrap = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(bootstrap.capture?.coreInput.phase).toBe("FINAL");
    expect(bootstrap.capture?.replayCandidates).toEqual([
      {
        eventKey: "777001:final",
        kind: "FINAL",
        occurredAt: "2026-08-27T22:00:00.000Z",
      },
    ]);
  });

  it("preserves a pending review for the C++ decision gate", async () => {
    const reviewed = play({
      atBatIndex: 9,
      halfInning: "bottom",
      eventType: "home_run",
      reviewDetails: { inProgress: true, isOverturned: false },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(feed("20260827_190000", [reviewed])));
    const client = new MlbRecordingClient(fetcher);
    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(result.capture?.coreInput.phase).toBe("REVIEW");
    expect(result.capture?.coreInput.plays[0].review).toBe("PENDING");
  });

  it("preserves a four-RBI home run as a grand slam through the C++ decision boundary", async () => {
    const priorPlay = play({ atBatIndex: 8, halfInning: "bottom" });
    const grandSlam = play({
      atBatIndex: 9,
      batterName: "Bo Bichette",
      eventType: "home_run",
      halfInning: "bottom",
      rbi: 4,
      resultDescription: "Bo Bichette hits a grand slam.",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feed("20260827_190000", [priorPlay])))
      .mockResolvedValueOnce(response(feed("20260827_190010", [priorPlay, grandSlam])));
    const client = new MlbRecordingClient(fetcher, () => new Date("2026-08-27T19:00:10Z"));
    const core = await GameCore.create();

    const bootstrap = await client.poll({ gamePk: 777001, gameNumber: 1 });
    if (!bootstrap.capture) throw new Error("Expected a bootstrap capture.");
    core.ingest(bootstrap.capture.coreInput, 0);

    const update = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(update.capture?.coreInput.plays).toMatchObject([
      { kind: "GRAND_SLAM", batterName: "Bo Bichette", battingTeamId: 121 },
    ]);
    if (!update.capture) throw new Error("Expected a grand-slam capture.");
    expect(core.ingest(update.capture.coreInput, 100).events).toMatchObject([
      { type: "CELEBRATION_STARTED", celebration: "GRAND_SLAM", subject: "Bo Bichette" },
    ]);
    core.dispose();
  });

  it("labels every weather delay RAIN DELAY, including a bare 'Delayed' explained by a game advisory", async () => {
    const currentPlay = play({
      atBatIndex: 10,
      halfInning: "bottom",
      isComplete: false,
    });
    // MLB's real mid-game shape: status "Delayed" (IO), reason on the advisory.
    const advisedPlay = {
      ...currentPlay,
      playEvents: [
        ...currentPlay.playEvents,
        {
          details: { description: "Status Change - Delayed: Rain", event: "Game Advisory", eventType: "game_advisory" },
        },
      ],
    };
    const feeds = [
      feed("20260827_190000", [currentPlay], "Delayed", {}, { reason: "Rain", statusCode: "IR" }),
      feed("20260827_190010", [currentPlay], "Delayed", {}, { statusCode: "IO" }),
      feed("20260827_190020", [advisedPlay], "Delayed", {}, { statusCode: "IO" }),
      feed("20260827_190030", [currentPlay], "Delayed: Lightning", {}, { reason: "Lightning", statusCode: "IL" }),
      feed("20260827_190040", [currentPlay], "Suspended: Rain", {}, { reason: "Rain", statusCode: "TR" }),
    ];
    const fetcher = vi.fn<typeof fetch>();
    for (const value of feeds) fetcher.mockResolvedValueOnce(response(value));
    const client = new MlbRecordingClient(fetcher);
    const labels: string[] = [];
    for (let index = 0; index < feeds.length; index += 1) {
      const result = await client.poll({ gamePk: 777001, gameNumber: 1 });
      expect(result.capture?.gameSnapshot.phase).toBe("DELAYED");
      labels.push(result.capture?.gameSnapshot.label ?? "");
    }
    expect(labels).toEqual(["RAIN DELAY", "Delayed", "RAIN DELAY", "RAIN DELAY", "Suspended: Rain"]);
  });

  it("preserves postponed and cancelled labels while treating completed-early games as final", async () => {
    const currentPlay = play({ atBatIndex: 11, halfInning: "bottom", isComplete: false });
    const fetcher = vi
      .fn<typeof fetch>()
      // MLB marks postponed and cancelled games abstractly Final; they must not read as a final score.
      .mockResolvedValueOnce(
        response(
          feed(
            "20260827_190000",
            [currentPlay],
            "Postponed",
            {},
            { abstractGameState: "Final", reason: "Rain", statusCode: "DR" },
          ),
        ),
      )
      .mockResolvedValueOnce(
        response(
          feed(
            "20260827_190010",
            [currentPlay],
            "Cancelled",
            {},
            { abstractGameState: "Final", reason: "Rain", statusCode: "CR" },
          ),
        ),
      )
      .mockResolvedValueOnce(response(feed("20260827_190020", [currentPlay], "Completed Early: Rain")));
    const client = new MlbRecordingClient(fetcher);

    const postponed = await client.poll({ gamePk: 777001, gameNumber: 1 });
    const cancelled = await client.poll({ gamePk: 777001, gameNumber: 1 });
    const completedEarly = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(postponed.capture?.gameSnapshot).toMatchObject({ phase: "DELAYED", label: "Postponed" });
    expect(cancelled.capture?.gameSnapshot).toMatchObject({ phase: "DELAYED", label: "Cancelled" });
    expect(completedEarly.capture?.gameSnapshot).toMatchObject({ phase: "FINAL", label: "FINAL" });
  });

  it("resets the count when the linescore advances to a new batter", async () => {
    const completedPlay = play({
      atBatIndex: 12,
      balls: 3,
      halfInning: "bottom",
      isComplete: true,
      strikes: 2,
    });
    const payload = feed("20260827_190000", [completedPlay], "In Progress", {
      defense: { pitcher: { id: 202, fullName: "Pitcher" } },
      offense: {
        batter: { id: 303, fullName: "Bo Bichette" },
        first: { id: 404, fullName: "Juan Soto" },
      },
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot.atBat).toMatchObject({
      balls: 0,
      strikes: 0,
      batter: "Bo Bichette",
      bases: { first: true, second: false, third: false },
    });
  });

  it("clears outs, bases, and the stale at-bat when a new inning starts", async () => {
    const priorInningPlay = play({
      atBatIndex: 18,
      balls: 2,
      halfInning: "bottom",
      inning: 6,
      strikes: 2,
    });
    const payload = feed("20260827_190000", [priorInningPlay], "In Progress", {
      currentInning: 7,
      inningHalf: "Top",
      offense: {
        batter: { id: 505, fullName: "Next Inning Batter" },
        first: { id: 606, fullName: "Stale Runner" },
      },
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot.outs).toBe(0);
    expect(result.capture?.gameSnapshot.atBat).toBeUndefined();
    expect(result.capture?.gameSnapshot.lastEvent).toBe("Top seventh begins");
    expect(result.capture?.coreInput.outs).toBe(3);
  });

  it("labels MLB's end-of-inning state as END rather than MID", async () => {
    const completedPlay = play({
      atBatIndex: 19,
      halfInning: "bottom",
      inning: 2,
    });
    const payload = feed("20260827_190005", [completedPlay], "In Progress", {
      currentInning: 2,
      inningHalf: "Bottom",
      inningState: "End",
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      atBat: undefined,
      half: "END",
      inning: 2,
      label: "LIVE",
      outs: 0,
      phase: "LIVE",
    });
  });

  it("labels only the changeover after the top half as MID", async () => {
    const completedPlay = play({
      atBatIndex: 20,
      halfInning: "top",
      inning: 3,
    });
    const payload = feed("20260827_190006", [completedPlay], "In Progress", {
      currentInning: 3,
      inningHalf: "Top",
      inningState: "Middle",
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      atBat: undefined,
      half: "MIDDLE",
      inning: 3,
      label: "LIVE",
      outs: 0,
      phase: "LIVE",
    });
  });

  it("goes straight to FINAL when a decisive bottom ninth reaches End before status catches up", async () => {
    const walkOff = play({
      atBatIndex: 72,
      halfInning: "bottom",
      inning: 9,
      resultDescription: "Mets win on a walk-off single.",
    });
    const payload = feed("20260827_220000", [walkOff], "In Progress", {
      currentInning: 9,
      inningHalf: "Bottom",
      inningState: "End",
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      atBat: undefined,
      half: "END",
      inning: 9,
      label: "FINAL",
      outs: 0,
      phase: "FINAL",
    });
    expect(result.capture?.coreInput).toMatchObject({ half: "END", inning: 9, phase: "FINAL" });
  });

  it("sends one Mets-win event when the inferred FINAL follows a tracked live frame", async () => {
    const priorPlay = play({
      atBatIndex: 71,
      halfInning: "bottom",
      inning: 9,
      isComplete: false,
    });
    const walkOff = play({
      atBatIndex: 71,
      halfInning: "bottom",
      inning: 9,
      resultDescription: "Mets win on a walk-off single.",
    });
    const tiedScore = {
      away: { runs: 2, hits: 7, errors: 0 },
      home: { runs: 2, hits: 8, errors: 0 },
    };
    const winningScore = {
      away: { runs: 2, hits: 7, errors: 0 },
      home: { runs: 3, hits: 9, errors: 0 },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          feed("20260827_215950", [priorPlay], "In Progress", {
            currentInning: 9,
            inningHalf: "Bottom",
            inningState: "Bottom",
            outs: 2,
            teams: tiedScore,
          }),
        ),
      )
      .mockResolvedValueOnce(
        response(
          feed("20260827_220000", [walkOff], "In Progress", {
            currentInning: 9,
            inningHalf: "Bottom",
            inningState: "End",
            outs: 2,
            teams: winningScore,
          }),
        ),
      );
    const client = new MlbRecordingClient(fetcher);
    const core = await GameCore.create();

    try {
      const bootstrap = await client.poll({ gamePk: 777001, gameNumber: 1 });
      if (!bootstrap.capture) throw new Error("Expected a live bootstrap capture.");
      expect(core.ingest(bootstrap.capture.coreInput, 0).events).toEqual([]);

      const final = await client.poll({ gamePk: 777001, gameNumber: 1 });
      if (!final.capture) throw new Error("Expected an inferred-final capture.");
      expect(final.capture.gameSnapshot).toMatchObject({ half: "END", label: "FINAL", phase: "FINAL" });
      expect(core.ingest(final.capture.coreInput, 1_000).events).toMatchObject([
        { type: "CELEBRATION_STARTED", celebration: "METS_WIN", subject: "Mets Win!" },
      ]);
    } finally {
      core.dispose();
    }
  });

  it("goes straight to FINAL when the home team leads after the top ninth", async () => {
    const finalOut = play({
      atBatIndex: 71,
      halfInning: "top",
      inning: 9,
      resultDescription: "Flyout ends the game.",
    });
    const payload = feed("20260827_215959", [finalOut], "In Progress", {
      currentInning: 9,
      inningHalf: "Top",
      inningState: "Middle",
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      half: "END",
      inning: 9,
      label: "FINAL",
      phase: "FINAL",
    });
  });

  it("keeps the top-ninth changeover live when the home team still must bat", async () => {
    const completedPlay = play({
      atBatIndex: 71,
      halfInning: "top",
      inning: 9,
    });
    const payload = feed("20260827_215959", [completedPlay], "In Progress", {
      currentInning: 9,
      inningHalf: "Top",
      inningState: "Middle",
      outs: 3,
      teams: {
        away: { runs: 4, hits: 8, errors: 0 },
        home: { runs: 3, hits: 7, errors: 0 },
      },
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      half: "MIDDLE",
      inning: 9,
      label: "LIVE",
      phase: "LIVE",
    });
  });

  it("keeps a tied End 9 live for extra innings", async () => {
    const completedPlay = play({
      atBatIndex: 72,
      halfInning: "bottom",
      inning: 9,
    });
    const payload = feed("20260827_220001", [completedPlay], "In Progress", {
      currentInning: 9,
      inningHalf: "Bottom",
      inningState: "End",
      outs: 3,
      teams: {
        away: { runs: 3, hits: 8, errors: 0 },
        home: { runs: 3, hits: 9, errors: 0 },
      },
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      half: "END",
      inning: 9,
      label: "LIVE",
      phase: "LIVE",
    });
  });

  it("keeps an unplayed home half blank when MLB supplies a placeholder zero", async () => {
    const currentPlay = play({ atBatIndex: 20, halfInning: "top", inning: 3, isComplete: false });
    const payload = feed("20260827_190010", [currentPlay], "In Progress", {
      currentInning: 3,
      inningHalf: "Top",
      inningState: "Top",
      innings: [
        { num: 1, away: { runs: 0 }, home: { runs: 1 } },
        { num: 2, away: { runs: 0 }, home: { runs: 0 } },
        { num: 3, away: { runs: 0 }, home: { runs: 0 } },
      ],
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot.linescore?.innings[2]).toEqual({ inning: 3, away: 0, home: null });
  });

  it("updates the activity line from the newest pitch event", async () => {
    const firstPitch = play({
      atBatIndex: 20,
      halfInning: "bottom",
      isComplete: false,
      playEventDescription: "Ball",
      resultDescription: "",
    });
    const secondPitch = play({
      atBatIndex: 20,
      halfInning: "bottom",
      isComplete: false,
      playEventDescription: "Called Strike",
      resultDescription: "",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feed("20260827_190000", [firstPitch])))
      .mockResolvedValueOnce(response(feed("20260827_190010", [secondPitch])));
    const client = new MlbRecordingClient(fetcher);

    expect((await client.poll({ gamePk: 777001, gameNumber: 1 })).capture?.gameSnapshot.lastEvent).toBe("Ball");
    expect((await client.poll({ gamePk: 777001, gameNumber: 1 })).capture?.gameSnapshot.lastEvent).toBe(
      "Called Strike",
    );
  });

  it("clears the live situation and labels the game FINAL when it ends", async () => {
    const finalPlay = play({
      atBatIndex: 24,
      balls: 3,
      halfInning: "bottom",
      inning: 9,
      strikes: 2,
    });
    const payload = feed("20260827_220000", [finalPlay], "Final", {
      currentInning: 9,
      inningHalf: "Bottom",
      offense: { first: { id: 707, fullName: "Stale Runner" } },
      outs: 3,
    });
    const client = new MlbRecordingClient(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));

    const result = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(result.capture?.gameSnapshot).toMatchObject({
      atBat: undefined,
      half: "END",
      label: "FINAL",
      outs: 0,
      phase: "FINAL",
    });
  });

  it("accepts bounded RFC 6902 add, replace, remove and copy operations", () => {
    expect(
      applyJsonPatch({ score: 1, plays: [{ id: 1 }], stale: true, review: { pending: false } }, [
        { op: "replace", path: "/score", value: 2 },
        { op: "add", path: "/plays/-", value: { id: 2 } },
        { op: "copy", from: "/review/pending", path: "/review/confirmed" },
        { op: "remove", path: "/stale" },
      ]),
    ).toEqual({
      score: 2,
      plays: [{ id: 1 }, { id: 2 }],
      review: { pending: false, confirmed: false },
    });
  });

  it("applies wrapped MLB diff envelopes instead of falling back to a full feed", async () => {
    const oldPlay = play({ atBatIndex: 1, halfInning: "bottom" });
    const newPlay = play({ atBatIndex: 2, halfInning: "bottom", eventType: "home_run" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feed("20260827_190000", [oldPlay])))
      .mockResolvedValueOnce(
        response([
          {
            diff: [
              { op: "replace", path: "/metaData/timeStamp", value: "20260827_190010" },
              { op: "add", path: "/liveData/plays/allPlays/-", value: newPlay },
              { op: "replace", path: "/liveData/plays/currentPlay", value: newPlay },
              {
                op: "copy",
                from: "/liveData/plays/currentPlay/about/isComplete",
                path: "/liveData/plays/currentPlay/about/hasReview",
              },
            ],
          },
        ]),
      );
    const client = new MlbRecordingClient(fetcher, () => new Date("2026-08-27T19:00:10Z"));

    await client.poll({ gamePk: 777001, gameNumber: 1 });
    const update = await client.poll({ gamePk: 777001, gameNumber: 1 });

    expect(update.payloadKind).toBe("DIFF_PATCH");
    expect(update.capture?.coreInput.plays).toMatchObject([
      { kind: "HOME_RUN", batterName: "Juan Soto", battingTeamId: 121 },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("delivers a final transition even when MLB leaves the feed cursor unchanged", async () => {
    const finalPlay = play({ atBatIndex: 24, halfInning: "bottom", inning: 9 });
    const liveFeed = feed("20260827_220000", [finalPlay], "In Progress", {
      currentInning: 9,
      inningHalf: "Bottom",
      outs: 3,
    });
    const finalFeed = feed("20260827_220000", [finalPlay], "Final", {
      currentInning: 9,
      inningHalf: "Bottom",
      outs: 3,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(liveFeed))
      .mockResolvedValueOnce(response(finalFeed));
    const client = new MlbRecordingClient(fetcher, () => new Date("2026-08-27T22:00:30Z"));
    const core = await GameCore.create();

    const before = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(before.capture).toBeTruthy();
    if (!before.capture) throw new Error("Expected a bootstrap capture.");
    core.ingest(before.capture.coreInput, 0);
    const after = await client.poll({ gamePk: 777001, gameNumber: 1 });
    expect(after.capture?.gameSnapshot.phase).toBe("FINAL");
    expect(after.cursor).toBe("20260827_220000~000001");

    if (!after.capture) throw new Error("Expected a final-state capture.");
    const decision = core.ingest(after.capture.coreInput, 1_000);
    expect(decision.events).toMatchObject([
      { type: "CELEBRATION_STARTED", celebration: "METS_WIN", subject: "Mets Win!" },
    ]);
    core.dispose();
  });

  it("builds home-run, grand-slam, and final bookmarks from a completed archived feed", async () => {
    const homeRun = play({ atBatIndex: 18, halfInning: "bottom", eventType: "home_run", batterName: "Juan Soto" });
    const grandSlam = play({
      atBatIndex: 19,
      halfInning: "bottom",
      eventType: "home_run",
      batterName: "Bo Bichette",
      rbi: 4,
    });
    const archivedHomeRun = {
      ...homeRun,
      about: { ...homeRun.about, endTime: "2026-08-27T19:00:10.000Z" },
    };
    const archivedGrandSlam = {
      ...grandSlam,
      about: { ...grandSlam.about, endTime: "2026-08-27T19:00:20.000Z" },
    };
    const finalFeed = feed("20260827_220000", [archivedHomeRun, archivedGrandSlam], "Final");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(["20260827_190000", "20260827_190010", "20260827_190020", "20260827_220000"]))
      .mockResolvedValueOnce(response(finalFeed));

    const index = await fetchMlbHistoricalGameIndex(777001, fetcher);

    expect(index.timestamps).toHaveLength(4);
    expect(index.bookmarks).toMatchObject([
      {
        kind: "HOME_RUN",
        label: "Home run · Juan Soto",
        beforeTimecode: "20260827_190000",
        targetTimecode: "20260827_190010",
        battingTeamId: 121,
      },
      {
        kind: "GRAND_SLAM",
        label: "Grand slam · Bo Bichette",
        beforeTimecode: "20260827_190010",
        targetTimecode: "20260827_190020",
        battingTeamId: 121,
      },
      {
        kind: "FINAL",
        beforeTimecode: "20260827_190020",
        targetTimecode: "20260827_220000",
      },
    ]);
  });
});
