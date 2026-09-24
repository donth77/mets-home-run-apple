// Celebrations this browser has already shown, so opening the page again (a
// reload, another tab, a restarted browser) inside the replay window does not
// raise the Apple for the same home run twice.
const STORAGE_KEY = "virtual-apple:shown-celebrations";

// Far longer than the five-minute replay window, so a device clock running
// slow against MLB's play times still finds the entry. Older entries are
// deleted, never kept.
export const SHOWN_CELEBRATION_MEMORY_MS = 12 * 60 * 60_000;

/** The entries still inside the memory window; an unreadable record counts as empty. */
function currentEntries(nowMs: number) {
  let stored: unknown;
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    stored = {};
  }
  const entries = new Map<string, number>();
  if (typeof stored !== "object" || stored === null) return entries;
  for (const [eventKey, shownAt] of Object.entries(stored)) {
    // Either side of now, so an entry written under a wrong clock cannot linger.
    if (typeof shownAt === "number" && Math.abs(nowMs - shownAt) <= SHOWN_CELEBRATION_MEMORY_MS) {
      entries.set(eventKey, shownAt);
    }
  }
  return entries;
}

function saveEntries(entries: ReadonlyMap<string, number>) {
  if (entries.size === 0) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

/** Event keys of the celebrations this browser has shown within the memory window. */
export function readShownCelebrations(nowMs: number): Set<string> {
  return new Set(currentEntries(nowMs).keys());
}

/** Records a celebration as shown, deleting entries that have aged out. */
export function rememberShownCelebration(eventKey: string, nowMs: number) {
  try {
    saveEntries(currentEntries(nowMs).set(eventKey, nowMs));
  } catch {
    // A private window or blocked storage: this page still remembers it for itself.
  }
}

/** Deletes entries that have aged out, and the whole record once none are left. */
export function forgetExpiredCelebrations(nowMs: number) {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) saveEntries(currentEntries(nowMs));
  } catch {
    // Blocked storage holds nothing to clean up.
  }
}
