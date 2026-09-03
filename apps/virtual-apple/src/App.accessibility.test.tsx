/** @vitest-environment happy-dom */

import { getScenario } from "@apple/test-fixtures";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { Window as HappyDomWindow } from "happy-dom";
import { StrictMode } from "react";
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
const viewportTestState = vi.hoisted(() => ({ desktop: true }));
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

function expectedNextGameTimeZone() {
  return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date(NEXT_GAME_DATE))
    .find((part) => part.type === "timeZoneName")?.value;
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
      standby?: boolean;
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
        data-scoreboard-standby={String(scoreboardData?.standby)}
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
    matches: query === "(min-width: 691px)" ? viewportTestState.desktop : false,
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
  viewportTestState.desktop = true;
  Reflect.deleteProperty(window, "documentPictureInPicture");
  window.history.replaceState({}, "", "/");
});

describe("Virtual Apple accessibility", () => {
  it("shows the Demo controls only when the local debug query flag is present", () => {
    const hidden = render(<App />);
    expect(hidden.getByRole("heading", { level: 1, name: "Virtual Mets Apple" })).not.toBeNull();
    expect(hidden.container.querySelector(".virtual-controls")).toBeNull();
    expect(hidden.container.querySelector(".virtual-brand small")?.textContent).toBe("Citi Field");
    hidden.unmount();

    window.history.replaceState({}, "", "/?demo=1");
    const visible = render(<App />);
    expect(visible.container.querySelector(".control-label")?.textContent).toBe("Demo");
    expect(visible.container.textContent).not.toContain("Live & demo");
  });

  it("keeps document order aligned with the mobile reading and focus order", () => {
    viewportTestState.desktop = false;
    const { container } = render(<App />);
    const header = container.querySelector(".virtual-header");
    const scene = container.querySelector(".shared-apple-stage-slot");
    const gameStatus = container.querySelector(".moment-card");
    const upcomingGames = container.querySelector(".upcoming-games");
    const installPrompt = container.querySelector(".pwa-install");
    if (!header || !scene || !gameStatus || !upcomingGames || !installPrompt) {
      throw new Error("Expected the mobile page regions.");
    }

    expect(header.compareDocumentPosition(scene) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gameStatus.compareDocumentPosition(upcomingGames) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(upcomingGames.compareDocumentPosition(installPrompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("includes the browser time-zone code in visible and accessible schedule text", () => {
    const { container, getByRole } = render(<App />);
    const nextGameZone = container.querySelector(".moment-card__next-time-zone");
    const upcomingZone = container.querySelector(".upcoming-games > header small");
    const upcomingLink = getByRole("link", { name: /opens MLB Gameday in a new tab/i });

    expect(nextGameZone?.querySelector(".visually-hidden")?.textContent).toMatch(/^ \S+ time zone$/);
    expect(upcomingZone?.querySelector(".visually-hidden")?.textContent).toMatch(/^Times shown in \S+$/);
    expect(upcomingLink.getAttribute("aria-label")).toMatch(/ at .+ \S+; opens MLB Gameday/);
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
    ["game-delay", 0],
    ["game-suspended", 0],
    ["game-postponed", 0],
    ["game-cancelled", 0],
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
    expect(toggle.querySelector(".lucide-volume-off")).not.toBeNull();
    fireEvent.click(toggle);
    expect(soundTestState.toggle).toHaveBeenCalledOnce();
  });

  it("places desktop view controls beneath the upper-right radio", () => {
    const { container } = render(<App />);
    const rightHeader = container.querySelector(".virtual-header__right");

    expect(container.querySelector(".virtual-brand .virtual-view-controls")).toBeNull();
    expect(rightHeader?.children[0]?.classList.contains("radio-companion-slot")).toBe(true);
    expect(rightHeader?.children[1]?.classList.contains("virtual-view-controls")).toBe(true);
  });

  it("hides secondary widgets in Focus view and restores them without changing the scene", () => {
    const { container, getByRole } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const radioStream = container.querySelector("#mets-radio-stream");
    expect(radioStream).not.toBeNull();
    expect(container.querySelector(".radio-companion-slot")?.classList.contains("radio-companion-slot--hidden")).toBe(
      false,
    );
    expect(container.querySelector(".upcoming-games")).not.toBeNull();
    expect(container.querySelector(".moment-card")).not.toBeNull();

    fireEvent.click(getByRole("button", { name: "Enter Focus view" }));

    expect(container.querySelector(".virtual-shell")?.getAttribute("data-focus-mode")).toBe("true");
    expect(container.querySelector("#mets-radio-stream")).toBe(radioStream);
    expect(container.querySelector(".radio-companion-slot")?.classList.contains("radio-companion-slot--hidden")).toBe(
      true,
    );
    expect(container.querySelector(".upcoming-games")).toBeNull();
    expect(container.querySelector(".moment-card")).toBeNull();
    expect(getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" })).not.toBeNull();

    fireEvent.click(getByRole("button", { name: "Exit Focus view" }));
    expect(container.querySelector("#mets-radio-stream")).toBe(radioStream);
    expect(container.querySelector(".radio-companion-slot")?.classList.contains("radio-companion-slot--hidden")).toBe(
      false,
    );
    expect(container.querySelector(".upcoming-games")).not.toBeNull();
    expect(container.querySelector(".moment-card")).not.toBeNull();
  });

  it("keeps only the compact scorebug and Exit Focus control in Focus view", () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const { container, getByRole, queryByRole } = render(<App />);

    expect(container.querySelector(".virtual-hud")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "Enter Focus view" }));

    expect(container.querySelector(".virtual-hud")).not.toBeNull();
    expect(container.querySelectorAll(".virtual-view-controls button")).toHaveLength(1);
    expect(container.querySelector(".virtual-view-controls--focus")).not.toBeNull();
    expect(getByRole("button", { name: "Exit Focus view" })).not.toBeNull();
    expect(queryByRole("button", { name: "Turn scene sounds on" })).toBeNull();
    expect(queryByRole("button", { name: "Open Mini Apple" })).toBeNull();
  });

  it("keeps the radio visible and removes desktop view controls on mobile", () => {
    viewportTestState.desktop = false;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn().mockResolvedValue(window) },
    });
    const { container, getByRole, queryByRole } = render(<App />);

    expect(queryByRole("button", { name: "Enter Focus view" })).toBeNull();
    expect(queryByRole("button", { name: "Open Mini Apple" })).toBeNull();
    expect(getByRole("complementary", { name: "Mets radio companion" })).not.toBeNull();
    expect(getByRole("button", { name: "Add to home screen" })).not.toBeNull();
    expect(container.querySelector(".radio-companion-slot")?.classList.contains("radio-companion-slot--hidden")).toBe(
      false,
    );
  });

  it("moves the shared presentation into Mini Apple and restores it to the main page", async () => {
    enableDemo();
    playbackTestState.scenarioId = "live";
    const childWindow = new HappyDomWindow({ url: "https://virtual-mets-apple.test/" });
    const requestWindow = vi.fn().mockResolvedValue(childWindow as unknown as Window);
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow },
    });
    const { container, getByRole } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const radioStream = container.querySelector("#mets-radio-stream");
    const sharedStage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(getByRole("button", { name: "Open Mini Apple" }).querySelector(".lucide-picture-in-picture")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "Open Mini Apple" }));
    await waitFor(() => expect(childWindow.document.querySelector(".mini-apple-shell")).not.toBeNull());

    expect(requestWindow).toHaveBeenCalledWith({ height: 300, width: 420 });
    expect(container.querySelector(".mini-open-placeholder")?.textContent).toContain("Mini Apple is open");
    expect(container.querySelector(".mini-open-placeholder")?.textContent).not.toContain(
      "Live game tracking and sound are still running",
    );
    expect(container.querySelector("#mets-radio-stream")).toBe(radioStream);
    expect(container.querySelector('[role="img"][aria-label*="Virtual Home Run Apple"]')).toBeNull();
    expect(childWindow.document.querySelector('[role="img"][aria-label*="Virtual Home Run Apple"]')).toBe(sharedStage);
    const miniBottom = childWindow.document.querySelector(".mini-apple-bottom");
    expect(miniBottom?.children[0]?.classList.contains("mini-apple-scoreboard")).toBe(true);
    expect(miniBottom?.children[1]?.classList.contains("mini-apple-footer")).toBe(true);

    const returnButton = childWindow.document.querySelector(".mini-apple-return");
    if (!(returnButton instanceof childWindow.HTMLElement)) throw new Error("Missing Mini Apple return button");
    fireEvent.click(returnButton as unknown as HTMLElement);

    await waitFor(() =>
      expect(container.querySelector('[role="img"][aria-label*="Virtual Home Run Apple"]')).toBe(sharedStage),
    );
    expect(container.querySelector(".mini-open-placeholder")).toBeNull();
  });

  it("restores the same presentation before the native Mini Apple window closes", async () => {
    const childWindow = new HappyDomWindow({ url: "https://virtual-mets-apple.test/" });
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn().mockResolvedValue(childWindow as unknown as Window) },
    });
    const { container, getByRole } = render(<App />);
    const sharedStage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    fireEvent.click(getByRole("button", { name: "Open Mini Apple" }));
    await waitFor(() =>
      expect(childWindow.document.querySelector('[role="img"][aria-label*="Virtual Home Run Apple"]')).toBe(
        sharedStage,
      ),
    );

    childWindow.dispatchEvent(new childWindow.Event("pagehide"));

    await waitFor(() =>
      expect(container.querySelector('[role="img"][aria-label*="Virtual Home Run Apple"]')).toBe(sharedStage),
    );
    expect(container.querySelector(".mini-open-placeholder")).toBeNull();
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

  it("reports an away rain delay without making the Citi Field scene rain", () => {
    liveTestState.game = { venue: "Citizens Bank Park" };
    liveTestState.snapshot = getScenario("rain-delay").frames[0].snapshot;
    liveTestState.status = "POLLING";
    const { container, getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute("data-weather"),
    ).toBe("CLEAR");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("RAIN DELAY");
    expect(soundTestState.rainActive).toBe(true);
  });

  it.each([
    ["game-delay", "DELAY", "DELAY"],
    ["game-suspended", "SUSPENDED", "SUSP"],
    ["game-postponed", "POSTPONED", "PPD"],
    ["game-cancelled", "CANCELLED", "CANC"],
  ] as const)("names a %s as %s without rain", (scenarioId, headline, scorebugInning) => {
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = getScenario(scenarioId).frames[0].snapshot;
    liveTestState.status = "POLLING";
    const { container, getByRole } = render(<App />);

    expect(
      getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" }).getAttribute("data-weather"),
    ).toBe("CLEAR");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe(headline);
    expect(container.textContent).toContain(scorebugInning);
    expect(soundTestState.rainActive).toBe(false);
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
    const time = headline?.querySelector(":scope > time");
    const timeZone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(new Date(NEXT_GAME_DATE))
      .find((part) => part.type === "timeZoneName")?.value;
    expect(time?.childNodes[0]?.textContent).toBe(expectedNextGameTime());
    expect(time?.querySelector('.moment-card__next-time-zone > span[aria-hidden="true"]')?.textContent).toBe(timeZone);
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
    expect(stage.getAttribute("data-next-game")).toBe(
      `Tomorrow|${expectedNextGameTime()} ${expectedNextGameTimeZone()}`,
    );
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
    expect(container.querySelector(".apple-scorebug__event")).toBeNull();
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("FINAL");
    expect(container.querySelector(".moment-card__next")).toBeNull();
    expect(container.querySelector(".upcoming-games")).toBeNull();
    expect(container.textContent).not.toContain("METS WIN!");

    liveTestState.status = "CHECKING";
    rerender(<App />);
    expect(stage.getAttribute("data-scoreboard-label")).toBe("FINAL");
    expect(container.querySelector(".apple-scorebug__event")).toBeNull();

    liveTestState.game = undefined;
    liveTestState.snapshot = undefined;
    liveTestState.status = "BETWEEN_GAMES";
    rerender(<App />);
    expect(container.querySelector(".apple-scorebug")).toBeNull();
    expect(container.querySelector(".moment-card__next")).not.toBeNull();
  });

  it("shows a consistent standby presentation when live updates fail", () => {
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = getScenario("live").frames[0]?.snapshot;
    liveTestState.status = "ERROR";

    const { container, getByRole, queryByRole } = render(<App />);
    const shell = container.querySelector(".virtual-shell");
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });
    const scorebug = container.querySelector(".apple-scorebug");
    const announcement = container.querySelector('.visually-hidden[role="status"]')?.textContent ?? "";

    expect(shell?.getAttribute("data-feed-status")).toBe("standby");
    expect(shell?.getAttribute("data-phase")).toBe("STANDBY");
    expect(stage.getAttribute("data-scoreboard-label")).toBe("STANDBY");
    expect(stage.getAttribute("data-scoreboard-standby")).toBe("true");
    expect(scorebug?.querySelector(".apple-scorebug__standby strong")?.textContent).toBe("▼7");
    expect(scorebug?.querySelector(".apple-scorebug__event strong")?.textContent).toBe("STANDBY");
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("STANDBY");
    expect(container.querySelector(".moment-card p")?.textContent).toContain("try again momentarily");
    expect(queryByRole("complementary", { name: "Upcoming Mets games" })).toBeNull();
    expect(getByRole("complementary", { name: "Current game on MLB Gameday" }).textContent).toContain("Updates paused");
    expect(container.textContent).not.toContain("BETWEEN GAMES");
    expect(container.textContent).not.toContain("FINAL");
    expect(announcement).not.toContain("Final");
    expect(announcement).not.toContain("between games");
  });

  it("does not leak final from a retained snapshot into standby", () => {
    const finalSnapshot = getScenario("mets-win").frames.at(-1)?.snapshot;
    if (!finalSnapshot) throw new Error("Missing final fixture frame");
    liveTestState.game = { venue: "Citi Field" };
    liveTestState.snapshot = finalSnapshot;
    liveTestState.status = "ERROR";

    const { container, getByRole } = render(<App />);
    const stage = getByRole("img", { name: "Virtual Home Run Apple behind the center-field wall" });

    expect(stage.getAttribute("data-scoreboard-label")).toBe("STANDBY");
    expect(container.querySelector(".apple-scorebug__standby")?.textContent).toBe("");
    expect(container.querySelector(".apple-scorebug__standby strong")).toBeNull();
    expect(container.querySelector(".apple-scorebug__final")).toBeNull();
    expect(container.querySelector(".moment-card h2")?.textContent).toBe("STANDBY");
    expect(container.textContent).not.toContain("BETWEEN GAMES");
    expect(container.textContent).not.toContain("FINAL");
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
