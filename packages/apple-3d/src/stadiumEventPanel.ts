import type { StadiumScoreboardData } from "./types";

export function stadiumEventPanelText(data: Pick<StadiumScoreboardData, "lastEvent" | "phase">) {
  if (data.phase === "SLEEP") return null;
  return data.lastEvent.trim() || null;
}
