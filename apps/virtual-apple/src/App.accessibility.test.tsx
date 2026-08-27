/** @vitest-environment happy-dom */

import { getScenario } from "@apple/test-fixtures";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const playbackTestState = vi.hoisted(() => ({ frameIndex: 0, scenarioId: "sleep" }));
const actuatorTestState = vi.hoisted(() => ({ positionMm: undefined as number | undefined }));
const stageTestState = vi.hoisted(() => ({ scoreboardData: [] as Array<object | undefined> }));
const seasonTestState = vi.hoisted(() => ({ isOffseason: false, status: "READY" as const }));
const liveTestState = vi.hoisted(() => ({
  celebration: undefined as unknown,
  game: undefined as { venue?: string } | undefined,
  snapshot: undefined as unknown,
  status: "BETWEEN_GAMES",
}));
const scheduleTestState = vi.hoisted(() => ({
  location: "HOME" as "HOME" | "AWAY",
  venue: "Citi Field",
}));
const soundTestState = vi.hoisted(() => ({
  cue: undefined as { id: string; kind: "HOME_RUN" | "METS_WIN" } | undefined,
  enable: vi.fn(),
  enabled: false,
  rainActive: false,
  stop: vi.fn(),
  toggle: vi.fn(),
  winTrackPlaying: false,
}));
const NEXT_GAME_DATE = "2026-08-28T23:10:00Z";
const SCHEDULE_TEST_NOW = new Date("2026-08-27T12:00:00Z");

function expectedNextGameTime() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(NEXT_GAME_DATE));
}

vi.mock("canvas-confetti", () => ({
  default: {
    create: () => Object.assign(vi.fn(), { reset: vi.fn() }),
  },
}));

vi.mock("./useCelebrationSound", () => ({
  useCelebrationSound: (cue: { id: string; kind: "HOME_RUN" | "METS_WIN" } | undefined, rainActive: boolean) => {
    soundTestState.cue = cue;
    soundTestState.rainActive = rainActive;
    return {
      enable: soundTestState.enable,
      enabled: soundTestState.enabled,
      error: "",
      stop: soundTestState.stop,
      supported: true,
      toggle: soundTestState.toggle,
      winTrackPlaying: soundTestState.winTrackPlaying,
    };
  },
}));

vi.mock("@apple/apple-3d", () => ({
  AppleStage: ({
    positionMm,
    scoreboardData,
    weather,
  }: {
    positionMm: number;
    scoreboardData?: {
      atCitiField?: boolean;
      away?: { abbreviation: string };
      batterLine?: string;
      home?: { abbreviation: string };
      label?: string;
      nextGame?: { day: string; time: string };
      pitchCount?: number;
    };
    weather?: "CLEAR" | "RAIN";
  }) => {
    stageTestState.scoreboardData.push(scoreboardData);
    return (
      <div
        role="img"
        aria-label="Virtual Home Run Apple behind the center-field wall"
        data-away={scoreboardData?.away?.abbreviation}
        data-at-citi-field={String(scoreboardData?.atCitiField)}
        data-batter-line={scoreboardData?.batterLine}
        data-home={scoreboardData?.home?.abbreviation}
        data-next-game={
          scoreboardData?.nextGame ? `${scoreboardData.nextGame.day}|${scoreboardData.nextGame.time}` : undefined
        }
        data-pitch-count={scoreboardData?.pitchCount}
        data-position-mm={positionMm}
        data-scoreboard-label={scoreboardData?.label}
        data-weather={weather}
      />
    );
  },
  getTrademarkFreeTeamLogoUrl: async () => null,
  useActuatorSimulation: (positionMm: number) => ({
    positionMm: actuatorTestState.positionMm ?? positionMm,
  }),
}));

vi.mock("./useFixturePlayback", async () => {
  const { getScenario, scenarioDuration } = await import("@apple/test-fixtures");
  return {
    useFixturePlayback: () => {
      const scenario = getScenario(playbackTestState.scenarioId);
      return {
        activeFrame: scenario.frames[playbackTestState.frameIndex] ?? scenario.frames[0],
        durationMs: scenarioDuration(scenario),
        elapsedMs: 0,
        play: vi.fn(),
        playing: false,
        scenario,
        scenarioId: scenario.id,
        setPlaying: vi.fn(),
      };
    },
  };
});

vi.mock("./useLiveMetsGame", () => ({
  useLiveMetsGame: () => ({
    celebration: liveTestState.celebration,
    game: liveTestState.game,
    snapshot: liveTestState.snapshot,
    status: liveTestState.status,
    targetPositionMm: 0,
    reportPosition: vi.fn(),
  }),
}));

vi.mock("./useMlbSeasonPhase", () => ({
  useMlbSeasonPhase: () => ({
    date: "2026-08-27",
    isOffseason: seasonTestState.isOffseason,
    status: seasonTestState.status,
  }),
}));

vi.mock("./useMetsSchedule", () => ({
  useMetsSchedule: (enabled: boolean) =>
    enabled
      ? [
          {
            gameDate: NEXT_GAME_DATE,
            gameNumber: 1,
            gamePk: 800001,
            location: scheduleTestState.location,
            opponent: "Philadelphia Phillies",
            opponentAbbreviation: "PHI",
            opponentId: 143,
            venue: scheduleTestState.venue,
          },
        ]
      : [],
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
  }));
});

function enableDemo() {
  window.history.replaceState({}, "", "/?demo=1");
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  playbackTestState.frameIndex = 0;
  playbackTestState.scenarioId = "sleep";
  actuatorTestState.positionMm = undefined;
  stageTestState.scoreboardData.length = 0;
  seasonTestState.isOffseason = false;
  liveTestState.celebration = undefined;
  liveTestState.game = undefined;
  liveTestState.snapshot = undefined;
  liveTestState.status = "BETWEEN_GAMES";
  scheduleTestState.location = "HOME";
  scheduleTestState.venue = "Citi Field";
  soundTestState.cue = undefined;
  soundTestState.enable.mockReset();
  soundTestState.enabled = false;
  soundTestState.rainActive = false;
  soundTestState.stop.mockReset();
  soundTestState.toggle.mockReset();
  soundTestState.winTrackPlaying = false;
  window.history.replaceState({}, "", "/");
});

describe("Virtual Apple accessibility", () => {
  it("shows the Demo controls only when the local debug query flag is present", () => {
    const hidden = render(<App />);
    expect(hidden.container.querySelector(".virtual-controls")).toBeNull();
    expect(hidden.container.querySelector(".virtual-brand small")?.textContent).toBe("Citi Field");
    hidden.unmount();

    window.history.replaceState({}, "", "/?demo=1");
    const visible = render(<App />);
    expect(visible.container.querySelector(".control-label")?.textContent).toBe("Demo");
    expect(visible.container.textContent).not.toContain("Live & demo");
  });

  it("has no automatically detectable semantic accessibility violations", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".upcoming-game")).not.toBeNull());

    const results = await axe.run(container, {
      rules: {
        // Happy DOM has no layout engine; contrast is reviewed against the opaque card colors separately.
        "color-contrast": { enabled: false },
      },
    });

    expect(
      results.violations.map(({ help, id, nodes }) => ({ help, id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
  });

  it.each([
    ["live", 0],
    ["home-run", 1],
    ["grand-slam", 1],
    ["review-confirmed", 1],
    ["rain-delay", 0],
    ["mets-win", 2],
    ["offseason", 0],
  ] as const)("has no semantic accessibility violations in the %s presentation", async (scenarioId, frameIndex) => {
    enableDemo();
    playbackTestState.scenarioId = scenarioId;
    playbackTestState.frameIndex = frameIndex;
    const { container } = render(<App />);

    const results = await axe.run(container, {
      rules: {
        // Happy DOM has no layout engine; browser-level contrast remains a manual release check.
        "color-contrast": { enabled: false },
      },
    });

    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });

  it("uses a dedicated low-frequency live region for meaningful game state", () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const { container } = render(<App />);
    const gameStatus = container.querySelector('p.visually-hidden[role="status"]');

    expect(gameStatus?.textContent).toBe("ATL 2, NYM 2. BOT 7, 1 out.");
    expect(gameStatus?.textContent).not.toContain("92.8 mph");
    expect(container.querySelector(".moment-card")?.hasAttribute("aria-live")).toBe(false);
  });

  it("keeps scene audio opt-in with an accessible toggle", () => {
    const { getByRole } = render(<App />);
    const toggle = getByRole("button", { name: "Turn scene sounds on" });

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(soundTestState.toggle).toHaveBeenCalledOnce();
  });

  it.each([
    ["home-run", "HOME_RUN"],
    ["grand-slam", "HOME_RUN"],
    ["review-confirmed", "HOME_RUN"],
    ["mets-win", "METS_WIN"],
  ] as const)("routes the %s celebration to the %s sound", (scenarioId, kind) => {
    enableDemo();
    playbackTestState.frameIndex = scenarioId === "review-confirmed" ? 2 : 1;
    playbackTestState.scenarioId = scenarioId;
    render(<App />);

    expect(soundTestState.cue).toEqual({ id: `demo:${scenarioId}`, kind });
  });

  it("labels a live grand slam distinctly while retaining the home-run sound", () => {
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = getScenario("live").frames[0].snapshot;
    liveTestState.celebration = {
      eventKey: "777686:play-48",
      kind: "GRAND_SLAM",
      subject: "Pete Alonso",
    };
    liveTestState.status = "POLLING";
    const { container, getByRole } = render(<App />);
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(stage.getAttribute("data-scoreboard-label")).toBe("GRAND SLAM!!");
    expect(container.querySelector(".apple-scorebug__event strong")?.textContent).toBe("GRAND SLAM!!");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("GRAND SLAM!!");
    expect(container.querySelector(".moment-card p")?.textContent).toContain("Pete Alonso clears the bases");
    expect(soundTestState.cue).toEqual({ id: "777686:play-48", kind: "HOME_RUN" });
  });

  it("keeps celebration scoreboard data stable while only the Apple position changes", () => {
    enableDemo();
    playbackTestState.frameIndex = 1;
    playbackTestState.scenarioId = "home-run";
    actuatorTestState.positionMm = 24;
    const view = render(<App />);
    const firstScoreboardData = stageTestState.scoreboardData.at(-1);

    actuatorTestState.positionMm = 48;
    view.rerender(<App />);

    expect(stageTestState.scoreboardData.at(-1)).toBe(firstScoreboardData);
  });

  it.each(["Home run", "Grand slam", "Raise the Apple", "Review", "Delay", "Mets win"])(
    "automatically arms sound when the %s demo is selected",
    (label) => {
      enableDemo();
      const { getByRole } = render(<App />);

      fireEvent.click(getByRole("button", { name: label }));
      expect(soundTestState.enable).toHaveBeenCalledOnce();
    },
  );

  it("activates rain weather and the rain-delay widget only for a rain delay", () => {
    enableDemo();
    playbackTestState.scenarioId = "rain-delay";
    const { container, getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute("data-weather"),
    ).toBe("RAIN");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("RAIN DELAY");
    expect(soundTestState.rainActive).toBe(true);
  });

  it("uses a plain delay widget without rain weather for other delays", () => {
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = {
      ...getScenario("rain-delay").frames[0].snapshot,
      label: "Delayed: Power",
    };
    liveTestState.status = "POLLING";
    const { container, getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute("data-weather"),
    ).toBe("CLEAR");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("DELAY");
    expect(soundTestState.rainActive).toBe(false);
  });

  it("presents the next-game day and time as one headline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCHEDULE_TEST_NOW);
    const { container } = render(<App />);
    const nextGame = container.querySelector(".moment-card__next");
    const headline = container.querySelector(".moment-card__next-game");

    expect(nextGame?.querySelector(":scope > span")?.textContent).toBe("NEXT GAME");
    expect(headline?.children).toHaveLength(2);
    expect(headline?.querySelector(":scope > strong")).not.toBeNull();
    expect(headline?.querySelector(":scope > time")?.textContent).toBe(expectedNextGameTime());
    expect(container.querySelector(".moment-card > p")).toBeNull();
    expect(nextGame?.textContent).not.toContain("The Apple is resting");
  });

  it("uses the upcoming live matchup and hides the between-games scorebug", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCHEDULE_TEST_NOW);
    const { container, getByRole } = render(<App />);
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(stage.getAttribute("data-away")).toBe("PHI");
    expect(stage.getAttribute("data-home")).toBe("NYM");
    expect(stage.getAttribute("data-at-citi-field")).toBe("true");
    expect(stage.getAttribute("data-next-game")).toBe(`Tomorrow|${expectedNextGameTime()}`);
    expect(container.querySelector(".apple-scorebug")).toBeNull();
    expect(container.textContent).not.toContain("OFF");
    expect(container.textContent).not.toContain("MIA");
  });

  it("hides the Citi Field stadium label when the next game is away", () => {
    scheduleTestState.location = "AWAY";
    scheduleTestState.venue = "Citizens Bank Park";
    const { getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-at-citi-field",
      ),
    ).toBe("false");
  });

  it("hides the Citi Field stadium label when the current live game is elsewhere", () => {
    liveTestState.game = { venue: "Truist Park" };
    liveTestState.snapshot = getScenario("live").frames[0].snapshot;
    liveTestState.status = "POLLING";
    const { getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-at-citi-field",
      ),
    ).toBe("false");
  });

  it("hides the broadcast scorebug and selects the offseason stadium board", () => {
    enableDemo();
    playbackTestState.scenarioId = "offseason";
    const { container, getByRole } = render(<App />);

    expect(container.querySelector(".apple-scorebug")).toBeNull();
    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-scoreboard-label",
      ),
    ).toBe("OFFSEASON");
    expect(container.querySelector(".moment-card")).toBeNull();
  });

  it("uses the offseason presentation when MLB season metadata says the season is over", () => {
    seasonTestState.isOffseason = true;
    const { container, getByRole } = render(<App />);

    expect(container.querySelector(".apple-scorebug")).toBeNull();
    expect(container.querySelector(".upcoming-games")).toBeNull();
    expect(container.querySelector(".moment-card")).toBeNull();
    expect(container.querySelector('.skip-link[href="#game-status"]')).toBeNull();
    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-scoreboard-label",
      ),
    ).toBe("OFFSEASON");
  });

  it("links the active game to its MLB Gameday page", () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const { container, getByRole } = render(<App />);
    const gamedayLink = getByRole("link", { name: /open MLB Gameday in a new tab/i });
    const gamedayCard = getByRole("complementary", { name: "Current game on MLB Gameday" });

    expect(gamedayLink.getAttribute("href")).toBe("https://www.mlb.com/gameday/777686");
    expect(gamedayCard.textContent).toContain("ATL at NYM");
    expect(gamedayCard.textContent).toContain("Pitch-by-pitch, box score & Statcast");
    expect(container.querySelector(".gameday-card__score")).toBeNull();
  });

  it("hides MLB Gameday during the Mets-win takeover", () => {
    enableDemo();
    playbackTestState.frameIndex = 2;
    playbackTestState.scenarioId = "mets-win";
    const { queryByRole } = render(<App />);

    expect(queryByRole("complementary", { name: "Current game on MLB Gameday" })).toBeNull();
  });

  it("holds the Mets-win presentation until the selected song finishes", () => {
    enableDemo();
    playbackTestState.frameIndex = 2;
    playbackTestState.scenarioId = "mets-win";
    soundTestState.winTrackPlaying = true;
    const { getByRole, queryByRole, rerender } = render(<App />);
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(stage.getAttribute("data-scoreboard-label")).toBe("METS WIN!");
    expect(stage.getAttribute("data-position-mm")).toBe("50");

    playbackTestState.frameIndex = 4;
    rerender(<App />);
    expect(stage.getAttribute("data-scoreboard-label")).toBe("METS WIN!");
    expect(stage.getAttribute("data-position-mm")).toBe("50");
    expect(queryByRole("complementary", { name: "Current game on MLB Gameday" })).toBeNull();
    expect(queryByRole("complementary", { name: "Upcoming Mets games" })).toBeNull();

    soundTestState.winTrackPlaying = false;
    rerender(<App />);
    expect(stage.getAttribute("data-scoreboard-label")).toBe("FINAL");
    expect(stage.getAttribute("data-position-mm")).toBe("0");
  });

  it("keeps a Mets loss in the final presentation on both scoreboards", () => {
    const finalSnapshot = getScenario("mets-win").frames.at(-1)?.snapshot;
    if (!finalSnapshot) throw new Error("Missing final fixture frame");
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = {
      ...finalSnapshot,
      label: "Game Over",
      away: { id: 144, abbreviation: "ATL", name: "Braves", runs: 5 },
      home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 3 },
      lastEvent: "Braves defeat the Mets, 5-3.",
    };
    liveTestState.status = "FINAL";

    const { container, getByRole, rerender } = render(<App />);
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(stage.getAttribute("data-scoreboard-label")).toBe("FINAL");
    expect(container.querySelector(".apple-scorebug__final")?.textContent).toBe("FINAL");
    expect(container.querySelector(".apple-scorebug__event strong")?.textContent).toBe("FINAL");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("FINAL");
    expect(container.querySelector(".moment-card__next")).toBeNull();
    expect(container.textContent).not.toContain("METS WIN!");

    liveTestState.status = "CHECKING";
    rerender(<App />);
    expect(stage.getAttribute("data-scoreboard-label")).toBe("FINAL");
    expect(container.querySelector(".apple-scorebug__event strong")?.textContent).toBe("FINAL");

    liveTestState.game = undefined;
    liveTestState.snapshot = undefined;
    liveTestState.status = "BETWEEN_GAMES";
    rerender(<App />);
    expect(container.querySelector(".apple-scorebug")).toBeNull();
    expect(container.querySelector(".moment-card__next")).not.toBeNull();
  });

  it("waits for the Mets-win Apple to be fully raised before starting confetti", () => {
    enableDemo();
    playbackTestState.frameIndex = 2;
    playbackTestState.scenarioId = "mets-win";
    soundTestState.winTrackPlaying = true;
    actuatorTestState.positionMm = 49;
    const { container, rerender } = render(<App />);

    expect(container.querySelector(".victory-confetti")).toBeNull();

    actuatorTestState.positionMm = 50;
    rerender(<App />);
    expect(container.querySelector(".victory-confetti")).not.toBeNull();
  });

  it("shows the Mets batter and batter line while the Mets are batting", () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const { container, getByRole } = render(<App />);
    const footer = container.querySelector(".apple-scorebug__event");

    expect(footer?.textContent).toBe("JUAN SOTO1 FOR 2");
    expect(footer?.textContent).not.toContain("P:");
    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-batter-line",
      ),
    ).toBe("1–2");
  });

  it("uses a compact orange LIVE header and promotes the live description", () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const { container } = render(<App />);
    const status = container.querySelector(".moment-card");

    expect(status?.classList.contains("moment-card--live")).toBe(true);
    expect(status?.querySelector(":scope > span")?.textContent).toBe("LIVE");
    expect(status?.querySelector(":scope > h2")).toBeNull();
    expect(status?.querySelector(":scope > p")?.textContent).toBe("Pitch 4 · 92.8 mph sinker");
  });

  it("shows the Mets pitcher and pitch count while the Mets are pitching", () => {
    enableDemo();
    playbackTestState.frameIndex = 2;
    playbackTestState.scenarioId = "live";
    const { container, getByRole } = render(<App />);
    const footer = container.querySelector(".apple-scorebug__event");

    expect(footer?.textContent).toBe("KODAI SENGAP:87");
    expect(footer?.textContent).not.toContain("RONALD ACUÑA JR.");
    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute(
        "data-pitch-count",
      ),
    ).toBe("87");
  });
});
