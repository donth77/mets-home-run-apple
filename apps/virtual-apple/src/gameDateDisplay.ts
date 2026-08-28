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

export function gameDateParts(
  gameDate: string,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
) {
  const date = new Date(gameDate);
  const game = zonedCalendarParts(date, timeZone);
  const today = zonedCalendarParts(now, timeZone);
  const calendarDaysAway = calendarDayNumber(game) - calendarDayNumber(today);
  const day =
    calendarDaysAway === 0
      ? game.hour >= 17
        ? "Tonight"
        : "Today"
      : calendarDaysAway === 1
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);

  return {
    day,
    date: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date),
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
