export interface StadiumHeaderData {
  phase?: "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";
  label: string;
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  inning: number;
  outs: number;
  standby?: boolean;
  /** The round, such as "NLDS Game 3" or "Spring Training"; none in the regular season. */
  gameLabel?: string;
  nextGame?: {
    day: string;
    time: string;
  };
}

export function stadiumVenueLabel(atCitiField: boolean | undefined) {
  return atCitiField === false ? "" : "CITI FIELD";
}

export function stadiumHeaderText(data: StadiumHeaderData) {
  if (data.standby) {
    const inning =
      data.half === "TOP" ? `▲ ${data.inning}` : data.half === "BOTTOM" ? `▼ ${data.inning}` : `INNING ${data.inning}`;
    return {
      center: "STANDBY",
      right: `${inning}  ·  LAST UPDATE`,
    };
  }
  if (data.phase === "SLEEP") {
    const nextGame = data.nextGame ? `${data.nextGame.day.toUpperCase()} - ${data.nextGame.time}` : "SCHEDULE TBD";
    return {
      center: `${data.gameLabel?.toUpperCase() ?? "NEXT GAME"} · ${nextGame}`,
      right: "",
    };
  }

  const isFinal = data.phase === "FINAL";
  const plainLabel = !isFinal && data.label.trim().toUpperCase() === "FINAL" ? (data.phase ?? "LIVE") : data.label;
  // As on the physical Apple, the round stands in for a plain LIVE.
  const center = data.gameLabel && plainLabel.trim().toUpperCase() === "LIVE" ? data.gameLabel : plainLabel;
  const inningLabel =
    data.half === "TOP"
      ? `▲ ${data.inning}`
      : data.half === "BOTTOM"
        ? `▼ ${data.inning}`
        : data.half === "MIDDLE"
          ? `MID ${data.inning}`
          : `END ${data.inning}`;
  return {
    center: center.toUpperCase(),
    right: isFinal ? "" : `${inningLabel}  ·  ${Math.min(data.outs, 3)} OUT${data.outs === 1 ? "" : "S"}`,
  };
}
