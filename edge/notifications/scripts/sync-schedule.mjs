// Turns the notification watcher's Cron Trigger on while the Mets are playing
// and off the rest of the year, so the worker does not run at all in the
// offseason. The watcher only notifies for regular season and postseason
// games (see notifiesFor in src/watcher.ts), so it runs every minute while one
// falls within a week either side of today in New York. The week covers the
// run-up to Opening Day, the All-Star break, the gaps between postseason
// rounds and a daily run that GitHub skips.
//
// wrangler.toml declares no [triggers], so `wrangler deploy` leaves this
// schedule alone. The Notification schedule workflow runs this daily, and the
// site deploy runs it after publishing the worker.
//
//   node edge/notifications/scripts/sync-schedule.mjs                     apply it
//   node edge/notifications/scripts/sync-schedule.mjs --dry-run           only print the decision
//   node edge/notifications/scripts/sync-schedule.mjs --dry-run --date 2027-03-20
//
// Applying needs CLOUDFLARE_API_TOKEN (Workers Scripts edit, as for a deploy)
// and CLOUDFLARE_ACCOUNT_ID.

const worker = "virtual-mets-apple-notifications";
const metsTeamId = 121;
const windowDays = 7;
const inSeason = [{ cron: "* * * * *" }];
const offseason = [];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dateIndex = args.indexOf("--date");
if (dateIndex >= 0 && !dryRun) throw new Error("--date only works with --dry-run.");
const today = dateIndex >= 0 ? args[dateIndex + 1] : easternDate(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new Error("--date takes YYYY-MM-DD.");

function easternDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function describe(crons) {
  return crons.length > 0 ? crons.join(", ") : "off";
}

async function notifyingGames(date) {
  const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(metsTeamId));
  url.searchParams.set("startDate", shiftDate(date, -windowDays));
  url.searchParams.set("endDate", shiftDate(date, windowDays));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The MLB schedule answered ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload?.dates)) throw new Error("The MLB schedule came back without its dates.");
  // Spring training (S) and exhibitions (E) never notify. A game without a
  // gameType reads as the regular season, as it does in @apple/mlb-live-feed.
  return payload.dates
    .flatMap((day) => day.games ?? [])
    .filter((game) => game.gameType !== "S" && game.gameType !== "E");
}

async function schedules(init) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or pass --dry-run.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/schedules`,
    { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  );
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body?.success) {
    throw new Error(`Cloudflare answered ${response.status}: ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body.result.schedules.map((schedule) => schedule.cron);
}

const games = await notifyingGames(today);
const wanted = games.length > 0 ? inSeason : offseason;
const wantedCrons = wanted.map((schedule) => schedule.cron);
console.log(
  `${today}: ${games.length} regular season or postseason Mets games within ${windowDays} days, so the watcher should be ${describe(wantedCrons)}.`,
);
if (!dryRun) {
  const current = await schedules({ method: "GET" });
  if ([...current].sort().join("\n") === [...wantedCrons].sort().join("\n")) {
    console.log(`The watcher is already ${describe(current)}.`);
  } else {
    const updated = await schedules({ method: "PUT", body: JSON.stringify(wanted) });
    console.log(`Changed the watcher from ${describe(current)} to ${describe(updated)}.`);
  }
}
