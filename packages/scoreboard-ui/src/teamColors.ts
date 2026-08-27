const MLB_PRIMARY_COLORS: Readonly<Record<string, string>> = {
  ARI: "#a71930",
  ATL: "#ce1141",
  ATH: "#003831",
  BAL: "#df4601",
  BOS: "#bd3039",
  CHC: "#0e3386",
  CHW: "#27251f",
  CIN: "#c6011f",
  CLE: "#00385d",
  COL: "#33006f",
  CWS: "#27251f",
  DET: "#0c2340",
  HOU: "#002d62",
  KC: "#004687",
  KCR: "#004687",
  LAA: "#ba0021",
  LAD: "#005a9c",
  MIA: "#00a3e0",
  MIL: "#12284b",
  MIN: "#002b5c",
  NYM: "#002d72",
  NYY: "#0c2340",
  OAK: "#003831",
  PHI: "#e81828",
  PIT: "#27251f",
  SD: "#2f241d",
  SDP: "#2f241d",
  SEA: "#0c2c56",
  SF: "#fd5a1e",
  SFG: "#fd5a1e",
  STL: "#c41e3a",
  TB: "#092c5c",
  TBR: "#092c5c",
  TEX: "#003278",
  TOR: "#134a8e",
  WAS: "#ab0003",
  WSH: "#ab0003",
};

function darkenHex(hex: string, factor: number) {
  const channels = [1, 3, 5].map((offset) => Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * factor));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function channelLuminance(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastAgainstWhite(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance =
    0.2126 * channelLuminance(channels[0]) +
    0.7152 * channelLuminance(channels[1]) +
    0.0722 * channelLuminance(channels[2]);
  return 1.05 / (luminance + 0.05);
}

function accessiblePrimary(hex: string) {
  let candidate = hex;
  let factor = 1;
  while (contrastAgainstWhite(candidate) < 4.5 && factor > 0.35) {
    factor *= 0.9;
    candidate = darkenHex(hex, factor);
  }
  return candidate;
}

export function teamScorebugColors(abbreviation: string) {
  const brandPrimary = MLB_PRIMARY_COLORS[abbreviation.trim().toUpperCase()] ?? "#47586a";
  const primary = accessiblePrimary(brandPrimary);
  return { primary, dark: darkenHex(primary, 0.68) };
}
