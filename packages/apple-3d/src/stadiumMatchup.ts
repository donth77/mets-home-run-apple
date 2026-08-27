interface StadiumMatchupTeam {
  id?: number;
  abbreviation: string;
}

export interface StadiumMatchupData {
  away: StadiumMatchupTeam;
  home: StadiumMatchupTeam;
  phase?: "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  batter?: string;
  batterLine?: string;
  pitcher?: string;
  pitchCount?: number;
}

export interface StadiumMatchupFooter {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
}

function isMets(team: StadiumMatchupTeam) {
  return team.id === 121 || team.abbreviation.trim().toUpperCase() === "NYM";
}

export function stadiumMatchupFooter(data: StadiumMatchupData): StadiumMatchupFooter | null {
  if (data.phase && !["LIVE", "REVIEW", "DELAYED"].includes(data.phase)) return null;

  const metsAreHome = isMets(data.home);
  const metsAreAway = isMets(data.away);
  const metsAreBatting = (data.half === "BOTTOM" && metsAreHome) || (data.half === "TOP" && metsAreAway);
  const metsArePitching = (data.half === "TOP" && metsAreHome) || (data.half === "BOTTOM" && metsAreAway);

  if (!metsAreBatting && !metsArePitching) return null;

  if (metsAreBatting) {
    return {
      leftLabel: "OPPOSING PITCHER",
      leftValue: data.pitcher?.trim().toUpperCase() || "—",
      rightLabel: "PITCH COUNT",
      rightValue: data.pitchCount === undefined ? "—" : `${data.pitchCount} PITCHES`,
    };
  }

  return {
    leftLabel: "OPPOSING BATTER",
    leftValue: data.batter?.trim().toUpperCase() || "—",
    rightLabel: "BATTER LINE",
    rightValue: data.batterLine?.trim().toUpperCase() || "—",
  };
}
