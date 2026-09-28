const DAY_MS = 86_400_000;

interface ZonedCalendarParts {
  day: number;
  hour: number;
  month: number;
  year: number;
}

function zonedCalendarParts(date: Date, timeZone: string): ZonedCalendarParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    month: "numeric",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { day: value("day"), hour: value("hour"), month: value("month"), year: value("year") };
}

function calendarDayNumber(parts: ZonedCalendarParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
}

/** What MLB lists for a game whose start time is not set yet. */
export interface ListedGameDate {
  officialDate?: string;
  startTimeTbd?: boolean;
}

export function gameDateParts(
  gameDate: string,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  listed: ListedGameDate = {},
) {
  // Until MLB sets a start time it lists the game at 3:33 AM Eastern, the day
  // before anywhere west of Eastern: show MLB's own date and no time.
  const unsetTime = listed.startTimeTbd === true && /^\d{4}-\d{2}-\d{2}$/.test(listed.officialDate ?? "");
  const date = unsetTime ? new Date(`${listed.officialDate}T12:00:00Z`) : new Date(gameDate);
  const game = unsetTime ? zonedCalendarParts(date, "UTC") : zonedCalendarParts(date, timeZone);
  const today = zonedCalendarParts(now, timeZone);
  const calendarDaysAway = calendarDayNumber(game) - calendarDayNumber(today);
  const dayZone = unsetTime ? "UTC" : timeZone;
  const day =
    calendarDaysAway === 0
      ? unsetTime
        ? "Today"
        : game.hour >= 17
          ? "Tonight"
          : "Today"
      : calendarDaysAway === 1
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", { timeZone: dayZone, weekday: "short" }).format(date);

  return {
    day,
    date: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: dayZone }).format(date),
    time: unsetTime
      ? "TBD"
      : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date),
    timeSet: !unsetTime,
  };
}

export function timeZoneAbbreviation(
  date = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "UTC"
  );
}

export function nextGameLabelParts(label: string) {
  const detail = label.replace(/^NEXT GAME\s*[·•-]?\s*/i, "").trim();
  const match = detail.match(/^(.*?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
  return match ? { day: match[1].trim(), time: match[2].toUpperCase() } : { day: detail, time: "" };
}
