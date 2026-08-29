import { mlbTeamNickname } from "@apple/protocol";
import type { StadiumCelebrationKind } from "./stadiumCelebration";
import { stadiumEventPanelText } from "./stadiumEventPanel";
import { stadiumHeaderText, stadiumVenueLabel } from "./stadiumHeader";
import { stadiumInningScores, stadiumInningWindow } from "./stadiumInnings";
import { stadiumMatchupFooter } from "./stadiumMatchup";
import { getTrademarkFreeTeamLogoUrl } from "./teamLogos";
import type { StadiumScoreboardData } from "./types";

const teamLogoCache = new Map<number, Promise<HTMLImageElement | null>>();

export function loadTeamLogo(teamId?: number) {
  if (!teamId) return Promise.resolve(null);
  const cached = teamLogoCache.get(teamId);
  if (cached) return cached;

  const request = getTrademarkFreeTeamLogoUrl(teamId)
    .then(
      (source) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          if (!source) {
            resolve(null);
            return;
          }
          const logo = new Image();
          logo.onload = () => resolve(logo);
          logo.onerror = () => resolve(null);
          logo.src = source;
        }),
    )
    .catch(() => null);
  teamLogoCache.set(teamId, request);
  return request;
}

function drawContainedTeamLogo(
  context: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const logoWidth = Math.max(1, logo.naturalWidth || 256);
  const logoHeight = Math.max(1, logo.naturalHeight || 256);
  const scale = Math.min(width / logoWidth, height / logoHeight);
  const drawWidth = logoWidth * scale;
  const drawHeight = logoHeight * scale;
  context.drawImage(logo, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawMatchupFooter(context: CanvasRenderingContext2D, data: StadiumScoreboardData) {
  const matchup = stadiumMatchupFooter(data);
  if (!matchup) return;
  const width = context.canvas.width;
  const panelY = 620;
  const panelHeight = 72;
  const panelWidth = 530;

  context.fillStyle = "rgba(7, 25, 43, .96)";
  context.fillRect(34, panelY, panelWidth, panelHeight);
  context.fillRect(width - panelWidth - 34, panelY, panelWidth, panelHeight);
  context.fillStyle = "#f36b2b";
  context.fillRect(34, panelY, panelWidth, 5);
  context.fillRect(width - panelWidth - 34, panelY, panelWidth, 5);

  context.fillStyle = "#8fa8bc";
  context.font = "800 19px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText(matchup.leftLabel, 120, panelY + 28);
  context.textAlign = "right";
  context.fillText(matchup.rightLabel, width - 120, panelY + 28);

  context.fillStyle = "#ffffff";
  context.font = "900 31px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText(matchup.leftValue, 120, panelY + 59, panelWidth - 105);
  context.textAlign = "right";
  context.fillText(matchup.rightValue, width - 120, panelY + 59, panelWidth - 105);
}

export function drawOffseasonScoreboard(context: CanvasRenderingContext2D) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.clearRect(0, 0, width, height);

  const background = context.createRadialGradient(width / 2, height * 0.42, 60, width / 2, height * 0.42, width * 0.72);
  background.addColorStop(0, "#124e84");
  background.addColorStop(0.5, "#092e54");
  background.addColorStop(1, "#031321");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f36b2b";
  context.fillRect(0, 0, width, 18);
  context.fillRect(0, height - 18, width, 18);
  context.strokeStyle = "rgba(255, 255, 255, .2)";
  context.lineWidth = 3;
  context.strokeRect(35, 43, width - 70, height - 86);

  context.fillStyle = "#ff8a4c";
  context.font = "900 34px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("CITI FIELD · FLUSHING, NY", width / 2, 120);
  context.fillStyle = "#ffffff";
  context.font = "900 156px Arial Black, Arial, sans-serif";
  context.fillText("OFFSEASON", width / 2, 330, width - 150);
  context.fillStyle = "#b9d0e2";
  context.font = "800 56px Arial, sans-serif";
  context.fillText("THE APPLE IS RESTING", width / 2, 430, width - 180);

  context.fillStyle = "rgba(3, 16, 29, .72)";
  context.fillRect(150, 510, width - 300, 105);
  context.fillStyle = "#ff9b65";
  context.font = "900 30px Arial, sans-serif";
  context.fillText("SEE YOU WHEN BASEBALL RETURNS", width / 2, 575, width - 360);

  context.strokeStyle = "rgba(143, 184, 211, .14)";
  context.lineWidth = 1;
  for (let y = 0; y < height; y += 5) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
}

export function drawStadiumScoreboard(
  context: CanvasRenderingContext2D,
  data: StadiumScoreboardData,
  awayLogo: HTMLImageElement | null,
  homeLogo: HTMLImageElement | null,
  headerRightInset = 44,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#061421");
  background.addColorStop(1, "#02080e");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f36b2b";
  context.fillRect(0, 0, width, 13);
  const venueLabel = stadiumVenueLabel(data.atCitiField);
  if (venueLabel) {
    context.fillStyle = "#dcecff";
    context.font = "900 42px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(venueLabel, 44, 67);
  }
  const header = stadiumHeaderText(data);
  context.fillStyle = "#ff8a4c";
  context.font = "800 28px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(header.center, width / 2, 63);

  if (header.right) {
    context.fillStyle = "#b7cadb";
    context.font = "800 25px Arial, sans-serif";
    context.textAlign = "right";
    context.fillText(header.right, width - headerRightInset, 64);
  }

  const gridStartX = 382;
  const cellWidth = 92;
  const headerY = 142;
  const awayY = 253;
  const homeY = 393;
  const innings = stadiumInningWindow(data.inning);
  const columnLabels = [...innings.map(String), "R", "H", "E"];
  const activeInningIndex = innings.indexOf(data.inning);

  context.strokeStyle = "rgba(138, 177, 207, .25)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(34, 95);
  context.lineTo(width - 34, 95);
  context.moveTo(34, 178);
  context.lineTo(width - 34, 178);
  context.moveTo(34, 323);
  context.lineTo(width - 34, 323);
  context.moveTo(34, 463);
  context.lineTo(width - 34, 463);
  context.stroke();

  columnLabels.forEach((label, index) => {
    const x = gridStartX + index * cellWidth + cellWidth / 2;
    if (index === activeInningIndex) {
      context.fillStyle = "rgba(243, 107, 43, .24)";
      context.fillRect(gridStartX + index * cellWidth + 4, 104, cellWidth - 8, 353);
    }
    context.fillStyle = index >= 9 ? "#ff9b65" : "#829db3";
    context.font = "800 25px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(label, x, headerY);
  });

  const awayScores = stadiumInningScores(data, "away", innings);
  const homeScores = stadiumInningScores(data, "home", innings);
  const rows = [
    {
      team: data.away,
      logo: awayLogo,
      scores: awayScores,
      y: awayY,
      totals: [data.away.runs, data.linescore?.awayHits, data.linescore?.awayErrors],
    },
    {
      team: data.home,
      logo: homeLogo,
      scores: homeScores,
      y: homeY,
      totals: [data.home.runs, data.linescore?.homeHits, data.linescore?.homeErrors],
    },
  ];

  rows.forEach(({ team, logo, scores, totals, y }, rowIndex) => {
    context.fillStyle = rowIndex === 1 ? "rgba(10, 55, 101, .58)" : "rgba(21, 39, 57, .56)";
    context.fillRect(34, y - 64, width - 68, 118);
    if (rowIndex === 1) {
      context.fillStyle = "#f36b2b";
      context.fillRect(34, y - 64, 8, 118);
    }

    if (logo) {
      drawContainedTeamLogo(context, logo, 62, y - 47, 82, 82);
    } else {
      context.fillStyle = rowIndex === 1 ? "#0b4d8a" : "#3b5064";
      context.beginPath();
      context.arc(103, y - 6, 40, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "900 24px Arial, sans-serif";
      context.textAlign = "center";
      context.fillText(team.abbreviation, 103, y + 2);
    }
    context.fillStyle = "#f4f8fb";
    context.font = "900 36px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(team.abbreviation, 165, y - 5);
    context.fillStyle = "#91a8ba";
    context.font = "700 20px Arial, sans-serif";
    context.fillText(mlbTeamNickname(team).toUpperCase(), 165, y + 28);

    [...scores, ...totals].forEach((score, index) => {
      const x = gridStartX + index * cellWidth + cellWidth / 2;
      context.fillStyle = index >= 9 ? "#ffffff" : score === null || score === undefined ? "#546b7e" : "#dce7ef";
      context.font = index >= 9 ? "900 38px Arial, sans-serif" : "800 33px Arial, sans-serif";
      context.textAlign = "center";
      context.fillText(score === null || score === undefined ? "" : String(score), x, y + 6);
    });
  });

  const eventPanelText = stadiumEventPanelText(data);
  if (eventPanelText) {
    context.fillStyle = "#0b2236";
    context.fillRect(34, 500, width - 68, 99);
    context.fillStyle = "#f36b2b";
    context.fillRect(34, 500, 11, 99);
    context.fillStyle = "#ffffff";
    context.font = "900 33px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(eventPanelText, 72, 558, width - 145);
  }

  context.strokeStyle = "rgba(143, 184, 211, .18)";
  context.lineWidth = 1;
  for (let y = 0; y < height; y += 5) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
  if (data.half !== "END") drawMatchupFooter(context, data);
}

export function drawCelebrationScoreboard(
  context: CanvasRenderingContext2D,
  data: StadiumScoreboardData,
  elapsedMs: number,
  reducedMotion: boolean,
  celebrationKind: StadiumCelebrationKind,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const phase = reducedMotion ? 0.72 : (elapsedMs % 4400) / 4400;
  const showSecondaryPanel = reducedMotion || phase >= 0.4;
  const transitionProgress = reducedMotion ? 1 : Math.min(1, Math.max(0, (phase - 0.36) / 0.08));
  const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsedMs / 180) * 0.012;
  const hitter = data.batter?.trim().toUpperCase() || "NEW YORK METS";
  const metsAreAway = data.away.abbreviation.toUpperCase() === "NYM";
  const mets = metsAreAway ? data.away : data.home;
  const opponent = metsAreAway ? data.home : data.away;
  const isMetsWin = celebrationKind === "METS_WIN";
  const isGrandSlam = celebrationKind === "GRAND_SLAM";
  const primaryEyebrow = isMetsWin ? "FINAL · NEW YORK METS" : "NEW YORK METS";
  const primaryHeadline = isMetsWin ? "METS WIN!" : isGrandSlam ? "GRAND SLAM!!" : "HOME RUN";
  const secondaryEyebrow = isMetsWin ? "FINAL · PUT IT IN THE BOOKS!" : isGrandSlam ? "GRAND SLAM!!" : "HOME RUN";
  const secondaryHeadline = isMetsWin
    ? `${mets.abbreviation} ${mets.runs}  —  ${opponent.abbreviation} ${opponent.runs}`
    : hitter;

  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(width / 2, height * 0.46, 40, width / 2, height * 0.46, width * 0.68);
  background.addColorStop(0, "#14548e");
  background.addColorStop(0.48, "#0a315b");
  background.addColorStop(1, "#031221");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.18;
  context.translate((elapsedMs / 18) % 120, 0);
  context.fillStyle = "#7fb3db";
  for (let stripe = -14; stripe < 20; stripe += 1) {
    context.save();
    context.translate(stripe * 120, 0);
    context.transform(1, 0, -0.32, 1, 0, 0);
    context.fillRect(0, 0, 34, height);
    context.restore();
  }
  context.restore();

  context.fillStyle = "#f36b2b";
  context.fillRect(0, 0, width, 20);
  context.fillRect(0, height - 20, width, 20);
  context.strokeStyle = "rgba(255, 255, 255, .22)";
  context.lineWidth = 3;
  context.strokeRect(34, 42, width - 68, height - 84);

  context.save();
  context.translate(width / 2, height / 2);
  context.scale(pulse, pulse);
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (!showSecondaryPanel) {
    context.globalAlpha = 1 - transitionProgress;
    context.fillStyle = "#ff7a36";
    context.font = "900 56px Arial, sans-serif";
    context.fillText(primaryEyebrow, 0, -116);
    context.fillStyle = "#ffffff";
    context.font = `900 ${isMetsWin ? 184 : isGrandSlam ? 150 : 178}px Arial Black, Arial, sans-serif`;
    context.fillText(primaryHeadline, 0, 35, width - 150);
  } else {
    context.globalAlpha = transitionProgress;
    context.fillStyle = "#ff7a36";
    context.font = `900 ${isMetsWin ? 58 : 66}px Arial Black, Arial, sans-serif`;
    context.fillText(secondaryEyebrow, 0, -120, width - 150);
    context.fillStyle = "#ffffff";
    context.font = `900 ${isMetsWin ? 134 : 142}px Arial Black, Arial, sans-serif`;
    context.fillText(secondaryHeadline, 0, 48, width - 150);
  }
  context.restore();

  context.strokeStyle = "rgba(143, 184, 211, .13)";
  context.lineWidth = 1;
  for (let y = 0; y < height; y += 5) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
}
