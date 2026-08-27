export interface StadiumHeaderData {
  phase?: "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";
  label: string;
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  inning: number;
  outs: number;
  nextGame?: {
    day: string;
    time: string;
  };
}

export function stadiumVenueLabel(atCitiField: boolean | undefined) {
  return atCitiField === false ? "" : "CITI FIELD";
}

export function stadiumHeaderText(data: StadiumHeaderData) {
  if (data.phase === "SLEEP") {
    const nextGame = data.nextGame ? `${data.nextGame.day.toUpperCase()} - ${data.nextGame.time}` : "SCHEDULE TBD";
    return {
      center: `NEXT GAME · ${nextGame}`,
      right: "",
    };
  }

  const halfLabel = data.half === "TOP" ? "▲" : data.half === "BOTTOM" ? "▼" : "";
  return {
    center: data.label.toUpperCase(),
    right:
      data.half === "END"
        ? "FINAL"
        : `${halfLabel} ${data.inning}  ·  ${Math.min(data.outs, 3)} OUT${data.outs === 1 ? "" : "S"}`,
  };
}
