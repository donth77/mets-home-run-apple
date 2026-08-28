export type SceneRenderQuality = "full" | "conservative";

export const SCENE_RENDER_SETTINGS = {
  conservative: {
    antialias: false,
    dpr: 1,
    powerPreference: "default" as const,
    shadows: false,
  },
  full: {
    antialias: true,
    dpr: [1, 1.75] as [number, number],
    powerPreference: "high-performance" as const,
    shadows: "percentage" as const,
  },
};

interface SceneStartupRecord {
  attempt: number;
  pageId: string;
  startedAt: number;
}

export interface SceneStartupStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const SCENE_STARTUP_STORAGE_KEY = "virtual-apple:scene-startup:v2";
const LEGACY_SCENE_STARTUP_STORAGE_KEY = "virtual-apple:scene-startup";
const SCENE_STARTUP_PAGE_ID_KEY = "__virtualAppleSceneStartupPageId";
export const SCENE_STARTUP_RETRY_WINDOW_MS = 60_000;
export const SCENE_STARTUP_FALLBACK_ATTEMPT = 3;
export const SCENE_STARTUP_TIMEOUT_MS = 15_000;
export const SCENE_STABLE_AFTER_MS = 12_000;

export function sceneStartupPageId(
  pageScope: Record<string, unknown> | undefined,
  createId = () => `${Date.now()}:${Math.random()}`,
) {
  const existing = pageScope?.[SCENE_STARTUP_PAGE_ID_KEY];
  if (typeof existing === "string") return existing;
  const pageId = createId();
  if (pageScope) pageScope[SCENE_STARTUP_PAGE_ID_KEY] = pageId;
  return pageId;
}

export function sceneRenderQuality(startupAttempt: number, rendererAttempt: number): SceneRenderQuality {
  return startupAttempt > 1 || rendererAttempt > 0 ? "conservative" : "full";
}

function validStartupRecord(value: unknown): value is SceneStartupRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<SceneStartupRecord>;
  return (
    Number.isSafeInteger(record.attempt) &&
    Number(record.attempt) > 0 &&
    typeof record.pageId === "string" &&
    Number.isFinite(record.startedAt)
  );
}

function readStartupRecord(storage: SceneStartupStorage) {
  const source = storage.getItem(SCENE_STARTUP_STORAGE_KEY);
  if (!source) return undefined;
  const parsed: unknown = JSON.parse(source);
  return validStartupRecord(parsed) ? parsed : undefined;
}

export function beginSceneStartup(storage: SceneStartupStorage | undefined, pageId: string, now = Date.now()) {
  if (!storage) return 1;
  try {
    storage.removeItem(LEGACY_SCENE_STARTUP_STORAGE_KEY);
    const previous = readStartupRecord(storage);
    if (previous?.pageId === pageId) return previous.attempt;
    const elapsed = previous ? now - previous.startedAt : Number.POSITIVE_INFINITY;
    const previousAttempt = previous && elapsed >= 0 && elapsed <= SCENE_STARTUP_RETRY_WINDOW_MS ? previous.attempt : 0;
    const attempt = previousAttempt + 1;
    storage.setItem(SCENE_STARTUP_STORAGE_KEY, JSON.stringify({ attempt, pageId, startedAt: now }));
    return attempt;
  } catch {
    return 1;
  }
}

export function completeSceneStartup(storage: SceneStartupStorage | undefined, pageId: string) {
  if (!storage) return;
  try {
    const current = readStartupRecord(storage);
    if (current?.pageId === pageId) storage.removeItem(SCENE_STARTUP_STORAGE_KEY);
  } catch {
    // Storage may be unavailable or contain data that another page has already replaced.
  }
}

export function shouldBypassUnstableScene(startupAttempt: number) {
  return startupAttempt >= SCENE_STARTUP_FALLBACK_ATTEMPT;
}
