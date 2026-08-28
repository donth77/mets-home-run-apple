import { METS_TEAM_ID, type UpcomingMetsGame } from "@apple/mlb-live-feed";
import type { GameSnapshot, PresentationSnapshot } from "@apple/protocol";
import type { LiveCelebration, LiveMetsGameStatus } from "./useLiveMetsGame";

const restingSnapshot: GameSnapshot = {
  schemaVersion: 1,
  gamePk: 0,
  gameNumber: 1,
  phase: "SLEEP",
  label: "BETWEEN GAMES",
  away: { abbreviation: "TBD", name: "Next opponent", runs: 0 },
  home: { id: METS_TEAM_ID, abbreviation: "NYM", name: "Mets", runs: 0 },
  inning: 1,
  half: "TOP",
  outs: 0,
  review: "NONE",
  lastEvent: "The Apple is resting until the next Mets game.",
};

export const liveOffseasonSnapshot: GameSnapshot = {
  ...restingSnapshot,
  phase: "SLEEP",
  label: "OFFSEASON",
  away: { abbreviation: "—", name: "No opponent", runs: 0 },
  half: "END",
  lastEvent: "The Apple is resting until baseball returns to Citi Field.",
};

export function liveBetweenGamesSnapshot(game: UpcomingMetsGame | undefined): GameSnapshot {
  const mets = { id: METS_TEAM_ID, abbreviation: "NYM", name: "Mets", runs: 0 };
  const opponent = game
    ? { id: game.opponentId, abbreviation: game.opponentAbbreviation, name: game.opponent, runs: 0 }
    : restingSnapshot.away;
  const metsAtHome = game?.location !== "AWAY";
  return {
    ...restingSnapshot,
    gamePk: game?.gamePk ?? 0,
    gameNumber: game?.gameNumber ?? 1,
    away: metsAtHome ? opponent : mets,
    home: metsAtHome ? mets : opponent,
  };
}

export function isCitiFieldVenue(venue: string | undefined) {
  return venue?.trim().replace(/\s+/g, " ").toLowerCase() === "citi field";
}

function grandSlamDescription(batter: string) {
  return `${batter} clears the bases with a grand slam! The Home Run Apple is rising in center field!`;
}

export function fanFacingMoment(scenarioId: string, snapshot: PresentationSnapshot, homeRunPhrase: string) {
  const batter = snapshot.atBat?.batter ?? "A Mets hitter";
  if (scenarioId === "mets-win") {
    return { label: "METS WIN!", lastEvent: "Put it in the books! The Apple celebrates another Mets victory." };
  }
  if (scenarioId === "grand-slam") {
    return { label: "GRAND SLAM!!", lastEvent: grandSlamDescription(batter) };
  }
  if (scenarioId === "home-run") return { label: "HOME RUN!", lastEvent: homeRunPhrase };
  if (scenarioId === "review-confirmed" && snapshot.review === "CONFIRMED") {
    return { label: "HOME RUN CONFIRMED!", lastEvent: `The call stands. ${batter}'s home run brings up the Apple!` };
  }
  if (scenarioId === "review-confirmed" || scenarioId === "review-overturned") {
    return {
      label: snapshot.label,
      lastEvent:
        snapshot.review === "OVERTURNED"
          ? "The call is overturned and play continues."
          : "The umpires are reviewing the play.",
    };
  }
  if (scenarioId === "rain-delay") {
    return { label: "RAIN DELAY", lastEvent: "The game is delayed. Stay tuned for an update." };
  }
  if (scenarioId === "offseason") {
    return { label: "OFFSEASON", lastEvent: "The Apple is resting until baseball returns to Citi Field." };
  }
  if (scenarioId === "sleep") {
    return { label: snapshot.label, lastEvent: "The Apple is resting until the next Mets game." };
  }
  return { label: snapshot.label, lastEvent: snapshot.lastEvent };
}

export function liveMoment(
  status: LiveMetsGameStatus,
  snapshot: PresentationSnapshot,
  celebration: LiveCelebration | undefined,
  homeRunPhrase: string,
) {
  if (celebration?.kind === "METS_WIN") {
    return { label: "METS WIN!", lastEvent: "Put it in the books! The Apple celebrates another Mets victory." };
  }
  if (celebration?.kind === "GRAND_SLAM") {
    return { label: "GRAND SLAM!!", lastEvent: grandSlamDescription(celebration.subject || "A Mets hitter") };
  }
  if (celebration?.kind === "HOME_RUN") return { label: "HOME RUN!", lastEvent: homeRunPhrase };
  if (status === "ERROR") {
    return {
      label: "STANDBY",
      lastEvent: "Live updates are temporarily unavailable. The Apple will try again momentarily.",
    };
  }
  if (status === "FINAL" || snapshot.phase === "FINAL") {
    return { label: "FINAL", lastEvent: snapshot.lastEvent };
  }
  if (status === "CHECKING") return { label: "BETWEEN GAMES", lastEvent: "Checking today’s Mets schedule…" };
  if (status === "BETWEEN_GAMES") {
    return { label: "BETWEEN GAMES", lastEvent: "The Apple is resting until the next Mets game." };
  }
  return { label: snapshot.label, lastEvent: snapshot.lastEvent };
}
