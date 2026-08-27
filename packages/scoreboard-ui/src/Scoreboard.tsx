import { inningLabel, type GameSnapshot } from "@apple/protocol";

export interface ScoreboardProps {
  snapshot: GameSnapshot;
  variant?: "lab" | "broadcast";
}

export function Scoreboard({ snapshot, variant = "broadcast" }: ScoreboardProps) {
  const occupiedOuts = Math.min(snapshot.outs, 3);

  return (
    <section className={`apple-scoreboard apple-scoreboard--${variant}`} aria-label="Game scoreboard" aria-live="polite">
      <div className="apple-scoreboard__teams">
        <div className="apple-scoreboard__team">
          <span>{snapshot.away.abbreviation}</span>
          <strong>{snapshot.away.runs}</strong>
        </div>
        <div className="apple-scoreboard__team apple-scoreboard__team--mets">
          <span>{snapshot.home.abbreviation}</span>
          <strong>{snapshot.home.runs}</strong>
        </div>
      </div>
      <div className="apple-scoreboard__state">
        <strong>{snapshot.label}</strong>
        <span>{inningLabel(snapshot)}</span>
      </div>
      <div className="apple-scoreboard__outs" aria-label={`${snapshot.outs} outs`}>
        <span>OUTS</span>
        <div>{[0, 1, 2].map((out) => <i key={out} className={out < occupiedOuts ? "is-on" : ""} />)}</div>
      </div>
      {snapshot.gameNumber === 2 && <span className="apple-scoreboard__game">GAME 2</span>}
    </section>
  );
}
