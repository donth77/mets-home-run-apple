import { inningLabel, type PresentationSnapshot } from "@apple/protocol";

export function gameStatusAnnouncement(
  snapshot: PresentationSnapshot,
  options: {
    betweenGames: boolean;
    offseason: boolean;
    standby?: boolean;
    nextGameDay?: string;
    nextGameTime?: string;
    /** The round, such as "NLDS Game 3" or "Spring Training"; none in the regular season. */
    gameLabel?: string;
  },
) {
  if (options.offseason) return "Mets baseball is currently in the offseason.";
  const round = options.gameLabel ? `${options.gameLabel}. ` : "";
  if (options.standby) {
    const score = `${snapshot.away.abbreviation} ${snapshot.away.runs}, ${snapshot.home.abbreviation} ${snapshot.home.runs}.`;
    const half = snapshot.half === "TOP" ? "TOP" : snapshot.half === "BOTTOM" ? "BOT" : "INNING";
    return `Live updates are temporarily unavailable. Standby. ${score} Last update: ${half} ${snapshot.inning}.`;
  }
  if (options.betweenGames) {
    const nextGame = [options.nextGameDay, options.nextGameTime].filter(Boolean).join(" at ");
    if (!nextGame) return "The Mets are between games.";
    return options.gameLabel ? `Next Mets game, ${options.gameLabel}: ${nextGame}.` : `Next Mets game: ${nextGame}.`;
  }

  const score = `${snapshot.away.abbreviation} ${snapshot.away.runs}, ${snapshot.home.abbreviation} ${snapshot.home.runs}.`;
  if (snapshot.phase === "FINAL") return `${round}Final. ${score}`;
  if (snapshot.phase === "DELAYED") return `${round}${snapshot.label}. ${score}`;
  if (snapshot.phase === "REVIEW") return `${round}Play under review. ${score}`;
  if (snapshot.phase === "CELEBRATION") return `${snapshot.label}. ${score}`;
  if (snapshot.phase === "PREGAME") return `${round}${snapshot.label}. ${score}`;

  const outs = `${snapshot.outs} ${snapshot.outs === 1 ? "out" : "outs"}`;
  return `${round}${score} ${inningLabel(snapshot)}, ${outs}.`;
}
