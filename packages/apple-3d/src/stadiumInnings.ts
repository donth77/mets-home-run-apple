import type { StadiumScoreboardData } from "./types";

export const STADIUM_INNING_COLUMN_COUNT = 9;

export function stadiumInningWindow(currentInning: number) {
  const normalizedInning = Math.max(1, Math.trunc(currentInning));
  const lastInning = Math.max(STADIUM_INNING_COLUMN_COUNT, normalizedInning);
  const firstInning = lastInning - STADIUM_INNING_COLUMN_COUNT + 1;
  return Array.from({ length: STADIUM_INNING_COLUMN_COUNT }, (_, index) => firstInning + index);
}

export function stadiumInningScores(
  data: StadiumScoreboardData,
  side: "away" | "home",
  innings = stadiumInningWindow(data.inning),
) {
  const recordedInnings = data.linescore?.innings ?? [];
  const cells = innings.map((inningNumber) => {
    const isCurrentInning = inningNumber === data.inning;
    const existing = recordedInnings.find((inning) => inning.inning === inningNumber);
    const homeScoreExists = existing?.home !== null && existing?.home !== undefined;
    const inningHasStarted =
      inningNumber < data.inning ||
      (isCurrentInning &&
        data.phase !== "PREGAME" &&
        data.phase !== "SLEEP" &&
        (side === "away" ||
          data.half === "BOTTOM" ||
          data.half === "END" ||
          (data.half === "MIDDLE" && homeScoreExists)));
    if (!inningHasStarted) return null;
    return existing?.[side] ?? null;
  });
  const recordedTotal = recordedInnings.reduce<number>((sum, inning) => sum + (inning[side] ?? 0), 0);
  const unassignedRuns = data[side].runs - recordedTotal;
  const currentIndex = innings.indexOf(data.inning);
  if (unassignedRuns !== 0 && currentIndex >= 0 && cells[currentIndex] !== null) {
    cells[currentIndex] = Math.max(0, (cells[currentIndex] ?? 0) + unassignedRuns);
  }
  return cells;
}
