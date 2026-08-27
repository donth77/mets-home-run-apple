import type { FixtureFrame, FixtureScenario } from "@apple/protocol";
import { gameplayScenarios } from "./scenarios/gameplay";
import { passiveScenarios } from "./scenarios/passive";

export const fixtureScenarios: readonly FixtureScenario[] = [...gameplayScenarios, ...passiveScenarios];

export function getScenario(id: string): FixtureScenario {
  return fixtureScenarios.find((scenario) => scenario.id === id) ?? fixtureScenarios[0];
}

export function scenarioDuration(scenario: FixtureScenario): number {
  return scenario.frames.at(-1)?.atMs ?? 0;
}

export function frameAt(scenario: FixtureScenario, atMs: number): FixtureFrame {
  let active = scenario.frames[0];
  for (const candidate of scenario.frames) {
    if (candidate.atMs > atMs) break;
    active = candidate;
  }
  return active;
}

export function nextFrameAt(scenario: FixtureScenario, atMs: number): number {
  return scenario.frames.find((candidate) => candidate.atMs > atMs)?.atMs ?? scenarioDuration(scenario);
}
