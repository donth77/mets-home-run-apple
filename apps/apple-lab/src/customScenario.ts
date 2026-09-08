import type {
  AppleCommand,
  AppleCoreEvent,
  FixtureFrame,
  FixtureScenario,
  GameHalf,
  PresentationSnapshot,
} from "@apple/protocol";

// A scenario the owner types in: everything the screen shows during a game
// and a celebration. It previews in the browser through the same renderer
// and decision recording the built-in fixtures use. It cannot run on the
// Apple, whose fixtures are compiled in and vetted.

export const CUSTOM_SCENARIO_ID = "custom";
const STORAGE_KEY = "apple-lab.custom-scenario";
const METS = { id: 121, abbreviation: "NYM", name: "Mets" } as const;

export type CustomCelebration = "NONE" | "HOME_RUN" | "GRAND_SLAM" | "METS_WIN";

export interface CustomScenarioForm {
  metsSide: "HOME" | "AWAY";
  opponentAbbreviation: string;
  opponentName: string;
  metsRuns: number;
  opponentRuns: number;
  inning: number;
  half: GameHalf;
  outs: number;
  balls: number;
  strikes: number;
  first: boolean;
  second: boolean;
  third: boolean;
  batter: string;
  batterLine: string;
  pitcher: string;
  pitchCount: number;
  lastEvent: string;
  phase: "LIVE" | "FINAL";
  celebration: CustomCelebration;
  subject: string;
}

export const defaultCustomScenario: CustomScenarioForm = {
  metsSide: "HOME",
  opponentAbbreviation: "ATL",
  opponentName: "Atlanta",
  metsRuns: 3,
  opponentRuns: 2,
  inning: 7,
  half: "BOTTOM",
  outs: 1,
  balls: 1,
  strikes: 2,
  first: true,
  second: false,
  third: false,
  batter: "Francisco Lindor",
  batterLine: "2–3",
  pitcher: "Strider",
  pitchCount: 74,
  lastEvent: "Lindor lines a single to center",
  phase: "LIVE",
  celebration: "HOME_RUN",
  subject: "",
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(value)));

/** Keep every field inside what the display can show. */
export function normalizeCustomScenario(form: CustomScenarioForm): CustomScenarioForm {
  return {
    ...form,
    opponentAbbreviation: form.opponentAbbreviation.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "OPP",
    opponentName: form.opponentName.trim().slice(0, 30) || "Opponent",
    metsRuns: clamp(form.metsRuns, 0, 99),
    opponentRuns: clamp(form.opponentRuns, 0, 99),
    inning: clamp(form.inning, 1, 19),
    outs: clamp(form.outs, 0, 2),
    balls: clamp(form.balls, 0, 3),
    strikes: clamp(form.strikes, 0, 2),
    batter: form.batter.trim().slice(0, 32),
    batterLine: form.batterLine.trim().slice(0, 11),
    pitcher: form.pitcher.trim().slice(0, 23),
    pitchCount: clamp(form.pitchCount, 0, 200),
    lastEvent: form.lastEvent.trim().slice(0, 100),
    subject: form.subject.trim().slice(0, 32),
  };
}

export function loadCustomScenario(): CustomScenarioForm {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeCustomScenario({ ...defaultCustomScenario, ...(JSON.parse(raw) as Partial<CustomScenarioForm>) });
  } catch {
    // Storage is optional.
  }
  return defaultCustomScenario;
}

export function saveCustomScenario(form: CustomScenarioForm): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {
    // Storage is optional.
  }
}

function baseSnapshot(form: CustomScenarioForm): PresentationSnapshot {
  const mets = { ...METS, runs: form.metsRuns };
  const opponent = { id: 0, abbreviation: form.opponentAbbreviation, name: form.opponentName, runs: form.opponentRuns };
  const innings = Array.from({ length: Math.min(form.inning, 9) }, (_, index) => ({
    inning: index + 1,
    away: 0,
    home: 0,
  }));
  return {
    schemaVersion: 1,
    gamePk: 999999,
    gameNumber: 1,
    phase: form.phase,
    label: form.phase,
    away: form.metsSide === "AWAY" ? mets : opponent,
    home: form.metsSide === "HOME" ? mets : opponent,
    inning: form.inning,
    half: form.half,
    outs: clamp(form.outs, 0, 2) as 0 | 1 | 2,
    review: "NONE",
    lastEvent: form.lastEvent,
    atBat: {
      balls: clamp(form.balls, 0, 3) as 0 | 1 | 2 | 3,
      strikes: clamp(form.strikes, 0, 2) as 0 | 1 | 2,
      bases: { first: form.first, second: form.second, third: form.third },
      batter: form.batter || "-",
      batterLine: form.batterLine || "-",
      pitcher: form.pitcher || "-",
      pitchCount: form.pitchCount,
    },
    linescore: { innings, awayHits: 0, homeHits: 0, awayErrors: 0, homeErrors: 0 },
  };
}

function frame(
  atMs: number,
  snapshot: PresentationSnapshot,
  positionMm: number,
  trace: string,
  commands: readonly AppleCommand[] = [],
  events: readonly AppleCoreEvent[] = [],
): FixtureFrame {
  return { atMs, snapshot, positionMm, events, commands, trace };
}

/** The scenario the Simulator plays for a form. Motion timings match the built-in fixtures. */
export function buildCustomScenario(input: CustomScenarioForm): FixtureScenario {
  const form = normalizeCustomScenario(input);
  const base = baseSnapshot(form);
  const eventKey = "custom:1";
  const win = form.celebration === "METS_WIN";
  const subject = win ? (form.subject || "Mets Win!") : form.subject || form.batter || "Mets batter";
  const upperSubject = subject.toUpperCase();
  const celebrating: PresentationSnapshot = win
    ? { ...base, phase: "CELEBRATION", label: "METS WIN!", lastEvent: "Mets win! Put it in the books!" }
    : {
        ...base,
        phase: "CELEBRATION",
        label: `${upperSubject} · ${form.celebration === "GRAND_SLAM" ? "GRAND SLAM" : "HOME RUN"}`,
        lastEvent: `${subject} ${form.celebration === "GRAND_SLAM" ? "hits a grand slam" : "homers"}`,
      };
  const after: PresentationSnapshot = win ? { ...base, phase: "FINAL", label: "FINAL" } : { ...base, phase: "LIVE", label: "LIVE" };
  const frames: FixtureFrame[] =
    form.celebration === "NONE"
      ? [
          frame(0, base, 0, "Custom game state rendered."),
          frame(2000, base, 0, "Custom game state held for the timeline."),
        ]
      : [
          frame(0, base, 0, "Custom game state rendered."),
          frame(
            900,
            celebrating,
            0,
            "Custom celebration accepted; display animation begins before motion.",
            [],
            [{ type: "CELEBRATION_STARTED", eventKey, celebration: form.celebration, subject }],
          ),
          frame(2900, celebrating, 50, "Display lead-in complete; extend command recorded.", [
            { type: "MOTION_EXTEND", eventKey, positionMm: 50, deadlineMs: 5000 },
          ]),
          frame(8000, celebrating, 50, "Extended limit reached after the measured stroke."),
          frame(38000, after, 0, "Raised dwell complete; retract command recorded.", [
            { type: "MOTION_RETRACT", eventKey, positionMm: 0, deadlineMs: 5000 },
          ]),
          frame(43100, after, 0, "Retracted limit reached."),
        ];
  return {
    id: CUSTOM_SCENARIO_ID,
    title: "Custom scenario",
    shortLabel: "Custom",
    description:
      form.celebration === "NONE"
        ? "Your own game state, shown exactly as the Apple would draw it."
        : `Your own game state, then a ${form.celebration.toLowerCase().replace("_", " ")} celebration for ${subject}.`,
    frames,
    deviceFixture: { schemaVersion: 1, fixtureVersion: 1, frames: [], expectedMotionSequences: form.celebration === "NONE" ? 0 : 1 },
  };
}
