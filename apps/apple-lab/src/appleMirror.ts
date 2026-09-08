import type { AppleCoreEvent, PresentationSnapshot } from "@apple/protocol";
import type { AppleStatus } from "./appleDevice";

// What the Apple's panel is showing, expressed for the Lab's C++ renderer.
// The firmware reports its screen state and any card text; the game screens
// are rebuilt from the same snapshot the Apple projects.

const placeholderLinescore: PresentationSnapshot["linescore"] = {
  innings: [],
  awayHits: 0,
  homeHits: 0,
  awayErrors: 0,
  homeErrors: 0,
};

/** The snapshot to render when the Apple has no live one: its next game as an upcoming card. */
export function mirrorSnapshot(status: AppleStatus): PresentationSnapshot {
  if (status.snapshot) return status.snapshot;
  const game = status.game;
  const offseason = status.mode === "OFFSEASON";
  return {
    schemaVersion: 1,
    gamePk: game?.gamePk ?? 0,
    gameNumber: game && game.gameNumber === 2 ? 2 : 1,
    phase: offseason ? "SLEEP" : "PREGAME",
    label: offseason ? "OFFSEASON" : "UPCOMING",
    away: { id: 0, abbreviation: game?.away ?? "---", name: game?.away ?? "", runs: 0 },
    home: { id: 0, abbreviation: game?.home ?? "---", name: game?.home ?? "", runs: 0 },
    inning: 0,
    half: "TOP",
    outs: 0,
    review: "NONE",
    lastEvent: "",
    scheduledStart: game?.scheduled,
    linescore: placeholderLinescore,
  };
}

/**
 * The celebration the Apple is showing, as far as status reveals it. The
 * exact animation picks are random on the device, so the Lab mirrors the
 * kind and subject and lets its own renderer choose the rest.
 */
export function mirrorCelebration(status: AppleStatus): AppleCoreEvent | undefined {
  if (status.screen?.state !== "CELEBRATION") return undefined;
  const playing = status.audio.playing.replace(/^\//, "").toLowerCase();
  const win = playing.startsWith("win") || (!status.audio.batter && status.lastCelebration?.kind === "WIN");
  const subject = win
    ? (status.lastCelebration?.subject ?? "METS WIN")
    : status.audio.batter || status.lastCelebration?.subject || "Mets batter";
  return {
    type: "CELEBRATION_STARTED",
    eventKey: `mirror:${status.sequence}:${subject}`,
    celebration: win ? "METS_WIN" : "HOME_RUN",
    subject,
  };
}
