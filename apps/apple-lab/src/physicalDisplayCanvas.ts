import type { DeviceDisplayState } from "@apple/protocol";

export const PHYSICAL_DISPLAY_WIDTH = 320;
export const PHYSICAL_DISPLAY_HEIGHT = 240;

const palette = {
  background: "#000119",
  metsBlue: "#002d72",
  panelBlue: "#0b2f46",
  mutedBlue: "#557489",
  orange: "#ff5910",
  gold: "#ffd23f",
  green: "#20b26b",
  yellow: "#edbc43",
  red: "#ef3e4d",
  rain: "#74b9e6",
  white: "#ffffff",
} as const;

const teamAccents: Readonly<Record<string, string>> = {
  ATL: "#ef3d5a",
  BAL: "#ff6a00",
  BOS: "#e84a5f",
  CHC: "#e23d4f",
  CIN: "#ef3340",
  CLE: "#f04450",
  CWS: "#c4ced4",
  HOU: "#f47d30",
  KC: "#7ab2dd",
  LAD: "#63a8e6",
  MIA: "#00b9e4",
  MIL: "#ffc52f",
  NYM: palette.orange,
  NYY: "#c4ced4",
  PHI: "#f43d49",
  PIT: "#fdb827",
  SD: "#ffc425",
  SEA: "#2ec4b6",
  SF: "#fd5a1e",
  STL: "#f04458",
  TB: "#8fbce6",
  TEX: "#ef3340",
  TOR: "#3d8de3",
  WSH: "#e13d52",
};

function font(size: number) {
  return `700 ${size}px "Courier New", ui-monospace, monospace`;
}

function text(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string = palette.white,
  align: CanvasTextAlign = "left",
) {
  context.fillStyle = color;
  context.font = font(size);
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillText(value, x, y);
}

function fittedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  maximumSize: number,
  color: string = palette.white,
) {
  let size = maximumSize;
  context.font = font(size);
  while (size > 8 && context.measureText(value).width > width) {
    size -= 1;
    context.font = font(size);
  }
  text(context, value, x + width / 2, y + (maximumSize - size) / 2, size, color, "center");
}

function frame(context: CanvasRenderingContext2D, accent: string = palette.orange) {
  context.fillStyle = palette.background;
  context.fillRect(0, 0, PHYSICAL_DISPLAY_WIDTH, PHYSICAL_DISPLAY_HEIGHT);
  context.fillStyle = palette.metsBlue;
  context.fillRect(0, 0, PHYSICAL_DISPLAY_WIDTH, 42);
  context.fillStyle = accent;
  context.fillRect(0, 38, PHYSICAL_DISPLAY_WIDTH, 4);
}

function diamond(context: CanvasRenderingContext2D, x: number, y: number, occupied: boolean) {
  context.beginPath();
  context.moveTo(x, y - 13);
  context.lineTo(x + 13, y);
  context.lineTo(x, y + 13);
  context.lineTo(x - 13, y);
  context.closePath();
  context.fillStyle = occupied ? palette.gold : palette.background;
  context.strokeStyle = occupied ? palette.gold : palette.white;
  context.lineWidth = 2;
  context.fill();
  context.stroke();
}

function drawLive(context: CanvasRenderingContext2D, state: DeviceDisplayState) {
  context.fillStyle = palette.background;
  context.fillRect(0, 0, PHYSICAL_DISPLAY_WIDTH, PHYSICAL_DISPLAY_HEIGHT);
  context.fillStyle = palette.metsBlue;
  context.fillRect(0, 0, PHYSICAL_DISPLAY_WIDTH, 58);
  context.fillStyle = palette.orange;
  context.fillRect(0, 54, PHYSICAL_DISPLAY_WIDTH, 4);

  text(context, state.away.abbreviation, 8, 13, 25, teamAccents[state.away.abbreviation] ?? palette.white);
  text(context, String(state.away.runs), 78, 13, 25);
  text(context, state.home.abbreviation, 238, 13, 25, teamAccents[state.home.abbreviation] ?? palette.white);
  text(context, String(state.home.runs), 305, 13, 25, palette.white, "right");

  const half = state.half === "BOTTOM" ? "BOT" : state.half === "MIDDLE" ? "MID" : state.half;
  text(context, `${half} ${state.inning}`, 160, 7, 16, palette.white, "center");
  text(
    context,
    state.kind === "REVIEW" ? "REVIEW" : "LIVE",
    160,
    34,
    9,
    state.kind === "REVIEW" ? palette.yellow : palette.green,
    "center",
  );

  const basesCenter = 95;
  diamond(context, basesCenter, 75, state.bases.second);
  diamond(context, basesCenter + 21, 96, state.bases.first);
  diamond(context, basesCenter - 21, 96, state.bases.third);
  for (let index = 0; index < 2; index += 1) {
    context.beginPath();
    context.arc(basesCenter - 10 + index * 20, 126, 6, 0, Math.PI * 2);
    context.lineWidth = 2;
    context.strokeStyle = palette.mutedBlue;
    if (index < state.outs) {
      context.fillStyle = palette.orange;
      context.fill();
    } else {
      context.stroke();
    }
  }
  text(context, "OUTS", basesCenter, 139, 9, palette.mutedBlue, "center");

  const countCenter = 225;
  text(context, "COUNT", countCenter, 72, 9, palette.mutedBlue, "center");
  text(context, `${state.balls ?? 0}-${state.strikes ?? 0}`, countCenter, 86, 32, palette.gold, "center");

  context.fillStyle = palette.mutedBlue;
  context.fillRect(0, 151, PHYSICAL_DISPLAY_WIDTH, 1);
  text(context, "BATTING", 12, 159, 9, palette.orange);
  if (state.batterLine) text(context, state.batterLine.replace("–", " FOR "), 148, 159, 9, palette.gold, "right");
  text(context, "PITCHING", 172, 159, 9, palette.orange);
  if (state.pitchCount !== undefined) text(context, `P:${state.pitchCount}`, 313, 159, 9, palette.gold, "right");
  fittedText(context, (state.batter ?? "-").toUpperCase(), 12, 173, 144, 16);
  fittedText(context, (state.pitcher ?? "-").toUpperCase(), 172, 173, 140, 16);

  const eventLines = wrapLines(context, state.lastEvent.toUpperCase(), 306, 2);
  const wraps = eventLines.length > 1;
  context.fillStyle = palette.panelBlue;
  context.fillRect(0, 199, PHYSICAL_DISPLAY_WIDTH, wraps ? 41 : 21);
  eventLines.forEach((line, index) => {
    text(context, line, 7, (wraps ? 203 : 206) + index * 20, 9);
  });
  if (!wraps) {
    context.fillStyle = palette.metsBlue;
    context.fillRect(0, 220, PHYSICAL_DISPLAY_WIDTH, 20);
    text(context, (state.venue ?? "").toUpperCase(), 7, 227, 9);
  }
}

function wrapLines(context: CanvasRenderingContext2D, value: string, width: number, limit: number) {
  context.font = font(9);
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) ?? "";
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= width) {
      if (current) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
      continue;
    }
    if (lines.length === limit) {
      lines[limit - 1] = `${lines[limit - 1].replace(/\.*$/, "")}...`;
      return lines;
    }
    lines.push(word);
  }
  if (lines.length > limit) {
    return [...lines.slice(0, limit - 1), `${lines[limit - 1]}...`];
  }
  return lines;
}

function upcomingTime(state: DeviceDisplayState) {
  if (!state.scheduledStart) return { date: state.status, time: "LOCAL TIME" };
  const startsAt = new Date(state.scheduledStart);
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })
    .format(startsAt)
    .toUpperCase();
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    .format(startsAt)
    .toUpperCase();
  return { date, time };
}

function drawUpcoming(context: CanvasRenderingContext2D, state: DeviceDisplayState) {
  frame(context);
  text(
    context,
    state.gameNumber === 2 ? "DOUBLEHEADER GAME 2" : "NEXT METS GAME",
    160,
    10,
    16,
    palette.white,
    "center",
  );
  text(context, state.away.abbreviation, 80, 77, 32, teamAccents[state.away.abbreviation] ?? palette.white, "center");
  text(context, "AT", 160, 89, 16, palette.mutedBlue, "center");
  text(context, state.home.abbreviation, 240, 77, 32, teamAccents[state.home.abbreviation] ?? palette.white, "center");
  context.strokeStyle = palette.mutedBlue;
  context.lineWidth = 2;
  context.strokeRect(26, 130, 268, 68);
  const local = upcomingTime(state);
  fittedText(context, local.date, 30, 142, 260, 16);
  fittedText(context, local.time, 30, 169, 260, 16, palette.gold);
  if (state.venue) fittedText(context, state.venue.toUpperCase(), 16, 211, 288, 9, palette.mutedBlue);
  context.fillStyle = palette.orange;
  context.fillRect(0, 232, PHYSICAL_DISPLAY_WIDTH, 8);
}

function drawOffseason(context: CanvasRenderingContext2D, state: DeviceDisplayState) {
  frame(context);
  text(context, "OFFSEASON", 160, 10, 16, palette.white, "center");
  context.fillStyle = palette.red;
  context.beginPath();
  context.arc(145, 79, 21, 0, Math.PI * 2);
  context.arc(174, 79, 21, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(125, 80);
  context.lineTo(194, 80);
  context.lineTo(160, 110);
  context.closePath();
  context.fill();
  context.fillStyle = palette.gold;
  context.fillRect(160, 48, 4, 19);
  text(context, "Z", 211, 62, 10, palette.mutedBlue, "center");
  text(context, "Z", 228, 48, 17, palette.mutedBlue, "center");
  context.fillStyle = palette.panelBlue;
  context.fillRect(72, 115, 174, 63);
  context.fillStyle = palette.orange;
  context.fillRect(72, 129, 174, 4);
  text(context, "SEE YOU NEXT SEASON", 160, 195, 16, palette.white, "center");
  context.fillStyle = palette.panelBlue;
  context.fillRect(0, 220, PHYSICAL_DISPLAY_WIDTH, 20);
  fittedText(context, state.status.toUpperCase(), 10, 226, 300, 9, palette.orange);
}

function drawFinal(context: CanvasRenderingContext2D, state: DeviceDisplayState) {
  frame(context);
  text(context, "FINAL", 160, 9, 25, palette.white, "center");
  fittedText(
    context,
    `${state.away.abbreviation} ${state.away.runs}`,
    34,
    62,
    252,
    32,
    teamAccents[state.away.abbreviation] ?? palette.white,
  );
  fittedText(
    context,
    `${state.home.abbreviation} ${state.home.runs}`,
    34,
    105,
    252,
    32,
    teamAccents[state.home.abbreviation] ?? palette.white,
  );
  const result =
    state.finalResult === "METS_WIN" ? "METS WIN" : state.finalResult === "TIE" ? "FINAL SCORE" : "FINAL SCORE";
  text(context, result, 160, 158, 20, state.finalResult === "METS_WIN" ? palette.orange : palette.white, "center");
  if (state.venue) fittedText(context, state.venue.toUpperCase(), 20, 215, 280, 9, palette.mutedBlue);
}

function statusCopy(state: DeviceDisplayState) {
  switch (state.kind) {
    case "REVIEW":
      return { title: "PLAY UNDER REVIEW", line1: "CALL PENDING", line2: "WAITING FOR REVIEW", accent: palette.yellow };
    case "RAIN_DELAY":
      return { title: "RAIN DELAY", line1: "", line2: "WAITING FOR UPDATE", accent: palette.rain };
    case "POSTPONED":
      return { title: "GAME POSTPONED", line1: "POSTPONED", line2: "NEXT GAME TBD", accent: palette.red };
    case "CANCELLED":
      return { title: "GAME CANCELLED", line1: "NO GAME", line2: "SCHEDULE UPDATE PENDING", accent: palette.red };
    case "SUSPENDED":
      return { title: "GAME SUSPENDED", line1: "PLAY STOPPED", line2: "WAITING FOR UPDATE", accent: palette.yellow };
    default:
      return { title: "GAME DELAYED", line1: "DELAY IN PROGRESS", line2: "WAITING FOR UPDATE", accent: palette.yellow };
  }
}

function drawStatus(context: CanvasRenderingContext2D, state: DeviceDisplayState, elapsedMs: number) {
  const copy = statusCopy(state);
  frame(context, copy.accent);
  fittedText(context, copy.title, 10, 10, 300, 16);
  context.fillStyle = palette.panelBlue;
  context.fillRect(22, 66, 276, 126);
  context.strokeStyle = copy.accent;
  context.lineWidth = 2;
  context.strokeRect(22, 66, 276, 126);
  if (state.kind === "RAIN_DELAY") {
    context.fillStyle = palette.mutedBlue;
    context.beginPath();
    context.arc(143, 96, 10, 0, Math.PI * 2);
    context.arc(160, 90, 15, 0, Math.PI * 2);
    context.arc(179, 97, 11, 0, Math.PI * 2);
    context.fill();
    context.fillRect(143, 96, 37, 12);
    context.strokeStyle = palette.rain;
    context.lineWidth = 2;
    const frameNumber = Math.floor(elapsedMs / 150) % 6;
    [0, 13, 5, 19, 9, 2, 16].forEach((offset, index) => {
      const x = 136 + index * 8;
      const y = 111 + ((offset + frameNumber * 4) % 24);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - 3, y + (index % 2 === 0 ? 8 : 6));
      context.stroke();
    });
  } else {
    context.strokeStyle = copy.accent;
    context.lineWidth = 4;
    context.beginPath();
    context.arc(160, 106, 21, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(160, 94);
    context.lineTo(160, 107);
    context.lineTo(172, 113);
    context.stroke();
  }
  if (copy.line1) text(context, copy.line1, 160, 134, 16, copy.accent, "center");
  text(context, copy.line2, 160, 164, 9, palette.white, "center");
  context.fillStyle = palette.panelBlue;
  context.fillRect(0, 220, PHYSICAL_DISPLAY_WIDTH, 20);
  text(context, "WAITING FOR MLB UPDATE", 160, 227, 9, copy.accent, "center");
}

export function drawDeviceDisplayFrame(context: CanvasRenderingContext2D, state: DeviceDisplayState, elapsedMs = 0) {
  context.clearRect(0, 0, PHYSICAL_DISPLAY_WIDTH, PHYSICAL_DISPLAY_HEIGHT);
  switch (state.kind) {
    case "LIVE":
    case "REVIEW":
      drawLive(context, state);
      break;
    case "UPCOMING":
      drawUpcoming(context, state);
      break;
    case "OFFSEASON":
      drawOffseason(context, state);
      break;
    case "FINAL":
      drawFinal(context, state);
      break;
    default:
      drawStatus(context, state, elapsedMs);
      break;
  }
}

export function describeDeviceDisplay(state: DeviceDisplayState) {
  if (state.kind === "LIVE" || state.kind === "REVIEW") {
    return `${state.away.abbreviation} ${state.away.runs}, ${state.home.abbreviation} ${state.home.runs}, ${state.half.toLowerCase()} ${state.inning}, ${state.outs} outs. ${state.lastEvent}`;
  }
  if (state.kind === "FINAL") {
    return `Final: ${state.away.abbreviation} ${state.away.runs}, ${state.home.abbreviation} ${state.home.runs}.`;
  }
  return `${state.kind.replaceAll("_", " ")}: ${state.status}.`;
}
