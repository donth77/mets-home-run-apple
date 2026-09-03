import { inningLabel, mlbTeamNickname, type AtBatState, type PresentationSnapshot } from "@apple/protocol";
import type { CSSProperties } from "react";
import { teamScorebugColors } from "./teamColors";

export interface ScoreboardProps {
  snapshot: PresentationSnapshot;
  variant?: "lab" | "broadcast";
  announceUpdates?: boolean;
  standby?: boolean;
}

function BaseDiamond({ bases }: { bases?: AtBatState["bases"] }) {
  return (
    <div
      className="apple-base-diamond"
      role="img"
      aria-label={
        [bases?.first && "runner on first", bases?.second && "runner on second", bases?.third && "runner on third"]
          .filter(Boolean)
          .join(", ") || "bases empty"
      }
    >
      <i className={bases?.second ? "is-on second" : "second"} />
      <i className={bases?.third ? "is-on third" : "third"} />
      <i className={bases?.first ? "is-on first" : "first"} />
    </div>
  );
}

function isMetsTeam(team: PresentationSnapshot["home"]) {
  return team.id === 121 || team.abbreviation.trim().toUpperCase() === "NYM";
}

function metsMatchupRole(snapshot: PresentationSnapshot): "BATTING" | "PITCHING" | null {
  const metsAreHome = isMetsTeam(snapshot.home);
  const metsAreAway = isMetsTeam(snapshot.away);
  if ((snapshot.half === "BOTTOM" && metsAreHome) || (snapshot.half === "TOP" && metsAreAway)) return "BATTING";
  if ((snapshot.half === "TOP" && metsAreHome) || (snapshot.half === "BOTTOM" && metsAreAway)) return "PITCHING";
  return null;
}

function compactBatterLine(line: string | undefined) {
  const match = line?.match(/^(\d+)[–-](\d+)(.*)$/);
  return match ? `${match[1]} FOR ${match[2]}${match[3]}` : line;
}

function compactInningLabel(snapshot: Pick<PresentationSnapshot, "half" | "inning">) {
  if (snapshot.inning < 1 || !["TOP", "BOTTOM", "MIDDLE"].includes(snapshot.half)) return null;
  if (snapshot.half === "TOP") return `▲${snapshot.inning}`;
  if (snapshot.half === "BOTTOM") return `▼${snapshot.inning}`;
  return `INN ${snapshot.inning}`;
}

function BroadcastScorebug({
  snapshot,
  announceUpdates,
  standby,
}: {
  snapshot: PresentationSnapshot;
  announceUpdates: boolean;
  standby: boolean;
}) {
  const teams = [
    { side: "away", team: snapshot.away },
    { side: "home", team: snapshot.home },
  ] as const;
  const isFinal = !standby && snapshot.phase === "FINAL";
  const showSituation =
    !standby &&
    !isFinal &&
    ["LIVE", "REVIEW", "DELAYED", "CELEBRATION"].includes(snapshot.phase) &&
    (snapshot.half === "TOP" || snapshot.half === "BOTTOM");
  const atBat = showSituation ? snapshot.atBat : undefined;
  const balls = atBat?.balls ?? 0;
  const strikes = atBat?.strikes ?? 0;
  const outs = showSituation ? snapshot.outs : 0;
  const isLiveInning = !["FINAL", "DELAYED", "SLEEP", "PREGAME"].includes(snapshot.phase);
  const inning = standby
    ? compactInningLabel(snapshot)
    : isLiveInning
      ? `${
          snapshot.half === "TOP"
            ? "▲"
            : snapshot.half === "BOTTOM"
              ? "▼"
              : snapshot.half === "MIDDLE"
                ? "MID "
                : "END "
        }${snapshot.inning}`
      : inningLabel(snapshot);
  const matchupRole = metsMatchupRole(snapshot);
  const showMatchup = !standby && ["LIVE", "REVIEW", "DELAYED"].includes(snapshot.phase) && matchupRole !== null;
  const snapshotLabel =
    snapshot.phase !== "FINAL" && snapshot.label.trim().toUpperCase() === "FINAL" ? snapshot.phase : snapshot.label;
  const footerLabel = standby
    ? "STANDBY"
    : showMatchup && matchupRole === "BATTING"
      ? (snapshot.atBat?.batter?.toUpperCase() ?? "METS AT BAT")
      : showMatchup && matchupRole === "PITCHING"
        ? (snapshot.atBat?.pitcher?.toUpperCase() ?? "METS PITCHING")
        : snapshotLabel;
  const footerDetail =
    showMatchup && matchupRole === "BATTING"
      ? compactBatterLine(snapshot.atBat?.batterLine)
      : showMatchup && matchupRole === "PITCHING" && snapshot.atBat?.pitchCount !== undefined
        ? `P:${snapshot.atBat.pitchCount}`
        : undefined;

  return (
    <section className="apple-scorebug" aria-label="Game scoreboard" aria-live={announceUpdates ? "polite" : "off"}>
      <div className="apple-scorebug__main">
        <div className="apple-scorebug__teams">
          {teams.map(({ side, team }) => {
            const isMets = team.id === 121 || team.abbreviation.toUpperCase() === "NYM";
            const colors = teamScorebugColors(team.abbreviation);
            const style = isMets
              ? undefined
              : ({
                  "--team-primary": colors.primary,
                  "--team-primary-dark": colors.dark,
                } as CSSProperties);
            return (
              <div
                className={isMets ? "apple-scorebug__team is-mets" : "apple-scorebug__team"}
                key={side}
                style={style}
              >
                <strong>{team.abbreviation}</strong>
                <b>{team.runs}</b>
              </div>
            );
          })}
        </div>
        <div
          className={
            standby
              ? "apple-scorebug__situation is-standby"
              : isFinal
                ? "apple-scorebug__situation is-final"
                : "apple-scorebug__situation"
          }
        >
          {isFinal ? (
            <strong className="apple-scorebug__final">FINAL</strong>
          ) : standby ? (
            <div className="apple-scorebug__standby">
              {inning && (
                <>
                  <span>INNING</span>
                  <strong>{inning}</strong>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="apple-scorebug__upper">
                <BaseDiamond bases={atBat?.bases} />
                <strong>{inning}</strong>
              </div>
              <div className="apple-scorebug__lower">
                <strong>
                  {balls}–{strikes}
                </strong>
                <span role="img" aria-label={`${outs} outs`}>
                  {[0, 1].map((out) => (
                    <i className={out < outs ? "is-on" : ""} key={out} />
                  ))}
                </span>
                {snapshot.gameNumber === 2 && <em>G2</em>}
              </div>
            </>
          )}
        </div>
      </div>
      {!isFinal && (
        <footer className="apple-scorebug__event">
          <strong>{footerLabel}</strong>
          {footerDetail && <b>{footerDetail}</b>}
        </footer>
      )}
    </section>
  );
}

function LabScoreboard({ snapshot, announceUpdates }: { snapshot: PresentationSnapshot; announceUpdates: boolean }) {
  const occupiedOuts = Math.min(snapshot.outs, 3);
  const gameDetail = snapshot.gameNumber === 2 ? "GAME 2" : `GAME ${snapshot.gameNumber}`;
  const teams = [
    { side: "away", team: snapshot.away },
    { side: "home", team: snapshot.home },
  ] as const;

  return (
    <section
      className="apple-scoreboard apple-scoreboard--lab"
      aria-label="Game scoreboard"
      aria-live={announceUpdates ? "polite" : "off"}
    >
      <header className="apple-scoreboard__header">
        <span className="apple-scoreboard__signal">
          <i /> {snapshot.phase}
        </span>
        <strong>{snapshot.label}</strong>
        <span>{gameDetail}</span>
      </header>
      <div className="apple-scoreboard__body">
        <div className="apple-scoreboard__teams">
          {teams.map(({ side, team }) => (
            <div
              className={
                isMetsTeam(team) ? "apple-scoreboard__team apple-scoreboard__team--mets" : "apple-scoreboard__team"
              }
              key={side}
            >
              <span className="apple-scoreboard__abbr">{team.abbreviation}</span>
              <span className="apple-scoreboard__name">{mlbTeamNickname(team)}</span>
              <strong>{team.runs}</strong>
            </div>
          ))}
        </div>
        <div className="apple-scoreboard__game-state">
          <div className="apple-scoreboard__inning">
            <span>INNING</span>
            <strong>{inningLabel(snapshot)}</strong>
          </div>
          <div className="apple-scoreboard__outs" role="img" aria-label={`${snapshot.outs} outs`}>
            <span>OUTS</span>
            <div>
              {[0, 1, 2].map((out) => (
                <i key={out} className={out < occupiedOuts ? "is-on" : ""} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <footer className="apple-scoreboard__event">{snapshot.lastEvent}</footer>
    </section>
  );
}

export function Scoreboard({
  snapshot,
  variant = "broadcast",
  announceUpdates = true,
  standby = false,
}: ScoreboardProps) {
  return variant === "broadcast" ? (
    <BroadcastScorebug snapshot={snapshot} announceUpdates={announceUpdates} standby={standby} />
  ) : (
    <LabScoreboard snapshot={snapshot} announceUpdates={announceUpdates} />
  );
}
