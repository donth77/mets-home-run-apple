import { deviceOffseasonSeasonLabel } from "@apple/device-display-wasm";
import type { DeviceDisplayState } from "@apple/protocol";

export function offseasonSeasonLabel(date: Date) {
  return deviceOffseasonSeasonLabel(date);
}

export function finalResultLabel(state: Pick<DeviceDisplayState, "away" | "home">) {
  if (state.away.runs === state.home.runs) return "TIE GAME";
  const mets =
    state.away.abbreviation === "NYM" ? state.away : state.home.abbreviation === "NYM" ? state.home : undefined;
  if (!mets) return undefined;
  const opponent = mets === state.away ? state.home : state.away;
  return mets.runs > opponent.runs ? "METS WIN" : undefined;
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
