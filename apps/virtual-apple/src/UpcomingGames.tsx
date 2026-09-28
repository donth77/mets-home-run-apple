import { useEffect, useState } from "react";
import { getTrademarkFreeTeamLogoUrl, teamLogoNeedsLightBackdrop } from "@apple/apple-3d";
import { gameDateParts, timeZoneAbbreviation } from "./gameDateDisplay";
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
    <span
      className="upcoming-game__logo"
      data-light-backdrop={source !== null && teamLogoNeedsLightBackdrop(teamId, abbreviation)}
      aria-hidden="true"
    >
      {source ? <img src={source} alt="" /> : <b>{abbreviation}</b>}
    </span>
  );
}

export function UpcomingGames({ games }: { games: readonly UpcomingMetsGame[] }) {
  if (games.length === 0) return null;

  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const firstGameTimeZone = timeZoneAbbreviation(new Date(games[0].gameDate), browserTimeZone);

  return (
    <aside className="upcoming-games" aria-label="Upcoming Mets games">
      <header>
        <div>
          <span>On deck</span>
          <h2>Upcoming Mets games</h2>
        </div>
        <small title={browserTimeZone}>
          <span aria-hidden="true">{firstGameTimeZone}</span>
          <span className="visually-hidden">Times shown in {firstGameTimeZone}</span>
        </small>
      </header>
      <ol>
        {games.map((game) => {
          const date = gameDateParts(game.gameDate, undefined, undefined, game);
          const gameTimeZone = timeZoneAbbreviation(new Date(game.gameDate), browserTimeZone);
          const venue = game.location === "HOME" ? (game.venue ?? "Citi Field") : (game.venue ?? game.opponent);
          const when = date.timeSet
            ? `${date.day} ${date.date} at ${date.time} ${gameTimeZone}`
            : `${date.day} ${date.date}, time to be announced`;
          return (
            <li key={game.gamePk}>
              <a
                className="upcoming-game"
                href={`https://www.mlb.com/gameday/${game.gamePk}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`${game.label ? `${game.label}: ` : ""}${game.location === "HOME" ? "Mets versus" : "Mets at"} ${game.opponent}, ${when}; opens MLB Gameday in a new tab`}
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
                  {game.label && <em className="upcoming-game__label">{game.label}</em>}
                  <span>{venue}</span>
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
