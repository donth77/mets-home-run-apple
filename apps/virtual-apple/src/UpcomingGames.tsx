import { useEffect, useState } from "react";
import { getTrademarkFreeTeamLogoUrl } from "@apple/apple-3d";
import { gameDateParts } from "./gameDateDisplay";
import type { UpcomingMetsGame } from "./useMetsSchedule";

function OpponentLogo({ abbreviation, teamId }: { abbreviation: string; teamId: number }) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    getTrademarkFreeTeamLogoUrl(teamId).then((nextSource) => {
      if (active) setSource(nextSource);
    });
    return () => {
      active = false;
    };
  }, [teamId]);

  return (
    <span className="upcoming-game__logo" aria-hidden="true">
      {source ? <img src={source} alt="" /> : <b>{abbreviation}</b>}
    </span>
  );
}

export function UpcomingGames({ games }: { games: readonly UpcomingMetsGame[] }) {
  if (games.length === 0) return null;

  return (
    <aside className="upcoming-games" aria-label="Upcoming Mets games">
      <header>
        <div>
          <span>On deck</span>
          <h2>Upcoming Mets games</h2>
        </div>
        <small>Local time</small>
      </header>
      <ol>
        {games.map((game) => {
          const date = gameDateParts(game.gameDate);
          return (
            <li key={game.gamePk}>
              <a
                className="upcoming-game"
                href={`https://www.mlb.com/gameday/${game.gamePk}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`${game.location === "HOME" ? "Mets versus" : "Mets at"} ${game.opponent}, ${date.day} ${date.date} at ${date.time}; opens MLB Gameday in a new tab`}
              >
                <OpponentLogo abbreviation={game.opponentAbbreviation} teamId={game.opponentId} />
                <time dateTime={game.gameDate}>
                  <strong>{date.day}</strong>
                  <span>{date.date}</span>
                </time>
                <div>
                  <strong>
                    {game.location === "HOME" ? "vs" : "at"} {game.opponentAbbreviation}
                    {game.gameNumber === 2 ? " · G2" : ""}
                  </strong>
                  <span>{game.location === "HOME" ? "Citi Field" : (game.venue ?? game.opponent)}</span>
                </div>
                <time className="upcoming-game__start" dateTime={game.gameDate}>
                  {date.time}
                </time>
              </a>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
