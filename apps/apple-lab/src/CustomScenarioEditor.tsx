import type { GameHalf } from "@apple/protocol";
import type { ChangeEvent } from "react";
import { type CustomCelebration, type CustomScenarioForm, defaultCustomScenario } from "./customScenario";

// The form behind the Simulator's Custom scenario: everything the Apple's
// screen shows in a game and in a celebration, editable in place.

const HALVES: readonly { value: GameHalf; label: string }[] = [
  { value: "TOP", label: "Top" },
  { value: "BOTTOM", label: "Bottom" },
  { value: "MIDDLE", label: "Middle" },
  { value: "END", label: "End" },
];
const CELEBRATIONS: readonly { value: CustomCelebration; label: string }[] = [
  { value: "NONE", label: "None — just the game screen" },
  { value: "HOME_RUN", label: "Home run" },
  { value: "GRAND_SLAM", label: "Grand slam" },
  { value: "METS_WIN", label: "Mets win" },
];

export function CustomScenarioEditor({
  form,
  onChange,
}: {
  form: CustomScenarioForm;
  onChange: (next: CustomScenarioForm) => void;
}) {
  const set = <K extends keyof CustomScenarioForm>(key: K, value: CustomScenarioForm[K]) =>
    onChange({ ...form, [key]: value });
  const num = (key: keyof CustomScenarioForm) => (event: ChangeEvent<HTMLInputElement>) =>
    set(key, Number(event.target.value) as never);
  const str = (key: keyof CustomScenarioForm) => (event: ChangeEvent<HTMLInputElement>) =>
    set(key, event.target.value as never);
  const win = form.celebration === "METS_WIN";

  return (
    <form className="custom-scenario" aria-label="Custom scenario" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <legend>Teams</legend>
        <label>
          Mets are the
          <select value={form.metsSide} onChange={(event) => set("metsSide", event.target.value as "HOME" | "AWAY")}>
            <option value="HOME">home team</option>
            <option value="AWAY">away team</option>
          </select>
        </label>
        <label>
          Opponent
          <input value={form.opponentAbbreviation} onChange={str("opponentAbbreviation")} maxLength={3} placeholder="ATL" />
        </label>
        <label>
          Opponent name
          <input value={form.opponentName} onChange={str("opponentName")} maxLength={30} placeholder="Atlanta" />
        </label>
        <label>
          Mets runs
          <input type="number" min={0} max={99} value={form.metsRuns} onChange={num("metsRuns")} />
        </label>
        <label>
          Opponent runs
          <input type="number" min={0} max={99} value={form.opponentRuns} onChange={num("opponentRuns")} />
        </label>
      </fieldset>
      <fieldset>
        <legend>Inning</legend>
        <label>
          Phase
          <select value={form.phase} onChange={(event) => set("phase", event.target.value as "LIVE" | "FINAL")}>
            <option value="LIVE">Live</option>
            <option value="FINAL">Final</option>
          </select>
        </label>
        <label>
          Half
          <select value={form.half} onChange={(event) => set("half", event.target.value as GameHalf)}>
            {HALVES.map((half) => (
              <option key={half.value} value={half.value}>
                {half.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inning
          <input type="number" min={1} max={19} value={form.inning} onChange={num("inning")} />
        </label>
        <label>
          Outs
          <input type="number" min={0} max={2} value={form.outs} onChange={num("outs")} />
        </label>
        <label>
          Balls
          <input type="number" min={0} max={3} value={form.balls} onChange={num("balls")} />
        </label>
        <label>
          Strikes
          <input type="number" min={0} max={2} value={form.strikes} onChange={num("strikes")} />
        </label>
        <fieldset className="custom-scenario__bases">
          <legend>Runners on base</legend>
          <label>
            <input type="checkbox" checked={form.first} onChange={(event) => set("first", event.target.checked)} /> 1st
          </label>
          <label>
            <input type="checkbox" checked={form.second} onChange={(event) => set("second", event.target.checked)} /> 2nd
          </label>
          <label>
            <input type="checkbox" checked={form.third} onChange={(event) => set("third", event.target.checked)} /> 3rd
          </label>
        </fieldset>
      </fieldset>
      <fieldset>
        <legend>Matchup</legend>
        <label>
          Batter
          <input value={form.batter} onChange={str("batter")} maxLength={32} placeholder="Francisco Lindor" />
        </label>
        <label>
          Batter line
          <input value={form.batterLine} onChange={str("batterLine")} maxLength={11} placeholder="2–3 · HR" />
        </label>
        <label>
          Pitcher
          <input value={form.pitcher} onChange={str("pitcher")} maxLength={23} placeholder="Strider" />
        </label>
        <label>
          Pitch count
          <input type="number" min={0} max={200} value={form.pitchCount} onChange={num("pitchCount")} />
        </label>
        <label className="custom-scenario__wide">
          Last play
          <input value={form.lastEvent} onChange={str("lastEvent")} maxLength={100} placeholder="Lindor lines a single to center" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Celebration</legend>
        <label>
          Kind
          <select value={form.celebration} onChange={(event) => set("celebration", event.target.value as CustomCelebration)}>
            {CELEBRATIONS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        {form.celebration !== "NONE" ? (
          <label className="custom-scenario__wide">
            {win ? "Headline" : "Player named on screen"}
            <input
              value={form.subject}
              onChange={str("subject")}
              maxLength={32}
              placeholder={win ? "Mets Win!" : form.batter || "Batter"}
            />
          </label>
        ) : null}
      </fieldset>
      <button type="button" className="text-button" onClick={() => onChange(defaultCustomScenario)}>
        Reset to example
      </button>
    </form>
  );
}
