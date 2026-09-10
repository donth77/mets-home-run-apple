import { prepareTeamLogoPixels, removeEmbeddedTeamLogoTrademark } from "./teamLogoArtwork";

const TEAM_LOGO_SIZE = 256;
const TEAM_LOGO_MAX_BYTES = 256 * 1024;
const TEAM_LOGO_TIMEOUT_MS = 10_000;
const teamLogoUrlCache = new Map<number, Promise<string | null>>();

// These primary marks are solid navy with no contrasting edge. Keep other
// artwork, including the Mets, on its existing background.
export function teamLogoNeedsLightBackdrop(teamId?: number, abbreviation = "") {
  return teamId === 147 || teamId === 116 || ["NYY", "DET"].includes(abbreviation.trim().toUpperCase());
}

function assertTeamId(teamId: number) {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    throw new Error("Team logos require a positive integer team ID.");
  }
}

async function boundedResponseText(response: Response) {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > TEAM_LOGO_MAX_BYTES) {
    throw new Error("Team logo response exceeded the maximum size.");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > TEAM_LOGO_MAX_BYTES) {
      throw new Error("Team logo response exceeded the maximum size.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > TEAM_LOGO_MAX_BYTES) {
        await reader.cancel();
        throw new Error("Team logo response exceeded the maximum size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(bytes);
}

export async function fetchTeamLogoSvg(teamId: number, fetcher: typeof fetch = fetch, callerSignal?: AbortSignal) {
  assertTeamId(teamId);
  const controller = new AbortController();
  const deadline = globalThis.setTimeout(
    () => controller.abort(new Error("Team logo request timed out.")),
    TEAM_LOGO_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetcher(`https://www.mlbstatic.com/team-logos/${teamId}.svg`, {
      cache: "force-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Team logo request failed with ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("image/svg+xml")) {
      throw new Error("Team logo response was not an SVG image.");
    }
    const source = await boundedResponseText(response);
    if (!/<svg[\s>]/i.test(source) || /<script[\s>]/i.test(source)) {
      throw new Error("Team logo response contained invalid SVG markup.");
    }
    return source;
  } finally {
    globalThis.clearTimeout(deadline);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function svgDataUrl(source: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function buildTrademarkFreeTeamLogoUrl(teamId: number) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;

  const source = removeEmbeddedTeamLogoTrademark(await fetchTeamLogoSvg(teamId), teamId);
  const image = await loadImage(svgDataUrl(source));
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = TEAM_LOGO_SIZE;
  canvas.height = TEAM_LOGO_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const sourceWidth = Math.max(1, image.naturalWidth || TEAM_LOGO_SIZE);
  const sourceHeight = Math.max(1, image.naturalHeight || TEAM_LOGO_SIZE);
  const scale = Math.min(TEAM_LOGO_SIZE / sourceWidth, TEAM_LOGO_SIZE / sourceHeight) * 0.92;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, (TEAM_LOGO_SIZE - drawWidth) / 2, (TEAM_LOGO_SIZE - drawHeight) / 2, drawWidth, drawHeight);
  const pixels = context.getImageData(0, 0, TEAM_LOGO_SIZE, TEAM_LOGO_SIZE);
  const offset = prepareTeamLogoPixels(pixels);
  context.clearRect(0, 0, TEAM_LOGO_SIZE, TEAM_LOGO_SIZE);
  context.putImageData(pixels, offset.x, offset.y);
  return canvas.toDataURL("image/png");
}

export function getTrademarkFreeTeamLogoUrl(teamId: number) {
  assertTeamId(teamId);
  const cached = teamLogoUrlCache.get(teamId);
  if (cached) return cached;

  const request = buildTrademarkFreeTeamLogoUrl(teamId).catch(() => null);
  teamLogoUrlCache.set(teamId, request);
  return request;
}
