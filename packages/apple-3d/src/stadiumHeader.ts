export interface StadiumHeaderData {
  phase?: "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";
  label: string;
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  inning: number;
  outs: number;
  standby?: boolean;
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
      center: `NEXT GAME · ${nextGame}`,
      right: "",
    };
  }

  const isFinal = data.phase === "FINAL";
  const center = !isFinal && data.label.trim().toUpperCase() === "FINAL" ? (data.phase ?? "LIVE") : data.label;
  const inningLabel =
    data.half === "TOP" ? `▲ ${data.inning}` : data.half === "BOTTOM" ? `▼ ${data.inning}` : `MID ${data.inning}`;
  return {
    center: center.toUpperCase(),
    right: isFinal ? "" : `${inningLabel}  ·  ${Math.min(data.outs, 3)} OUT${data.outs === 1 ? "" : "S"}`,
  };
}
