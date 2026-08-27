import { inningLabel, type PresentationSnapshot } from "@apple/protocol";

export function gameStatusAnnouncement(
  snapshot: PresentationSnapshot,
  options: {
    betweenGames: boolean;
    offseason: boolean;
    nextGameDay?: string;
    nextGameTime?: string;
  },
) {
  if (options.offseason) return "Mets baseball is currently in the offseason.";
  if (options.betweenGames) {
    const nextGame = [options.nextGameDay, options.nextGameTime].filter(Boolean).join(" at ");
    return nextGame ? `Next Mets game: ${nextGame}.` : "The Mets are between games.";
  }

  const score = `${snapshot.away.abbreviation} ${snapshot.away.runs}, ${snapshot.home.abbreviation} ${snapshot.home.runs}.`;
  if (snapshot.phase === "FINAL") return `Final. ${score}`;
  if (snapshot.phase === "DELAYED") return `${snapshot.label}. ${score}`;
  if (snapshot.phase === "REVIEW") return `Play under review. ${score}`;
  if (snapshot.phase === "CELEBRATION") return `${snapshot.label}. ${score}`;
  if (snapshot.phase === "PREGAME") return `${snapshot.label}. ${score}`;

  const outs = `${snapshot.outs} ${snapshot.outs === 1 ? "out" : "outs"}`;
  return `${score} ${inningLabel(snapshot)}, ${outs}.`;
}
