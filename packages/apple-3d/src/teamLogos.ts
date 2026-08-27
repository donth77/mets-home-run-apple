const TEAM_LOGO_SIZE = 256;
const TEAM_LOGO_MAX_BYTES = 256 * 1024;
const TEAM_LOGO_TIMEOUT_MS = 10_000;
const teamLogoUrlCache = new Map<number, Promise<string | null>>();

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

function clearLikelyTrademarkComponents(context: CanvasRenderingContext2D, width: number, height: number) {
  const image = context.getImageData(0, 0, width, height);
  const visited = new Uint8Array(width * height);
  const components: number[][] = [];
  let opaquePixels = 0;

  for (let pixel = 0; pixel < visited.length; pixel += 1) {
    if (image.data[pixel * 4 + 3] >= 24) opaquePixels += 1;
  }

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || image.data[start * 4 + 3] < 24) continue;

    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (visited[next] || image.data[next * 4 + 3] < 24) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    components.push(component);
  }

  const largestComponent = Math.max(0, ...components.map((component) => component.length));
  const smallComponentLimit = Math.max(48, Math.floor(opaquePixels * 0.025));

  components.forEach((component) => {
    if (component.length === largestComponent || component.length > smallComponentLimit) return;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    component.forEach((pixel) => {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    const inLowerRight = minX >= width * 0.55 && minY >= height * 0.48;
    const nearOuterEdge = maxX >= width * 0.86 || maxY >= height * 0.86;
    if (!inLowerRight || !nearOuterEdge) return;

    component.forEach((pixel) => {
      image.data[pixel * 4 + 3] = 0;
    });
  });

  context.putImageData(image, 0, 0);
}

async function buildTrademarkFreeTeamLogoUrl(teamId: number) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;

  const image = await loadImage(svgDataUrl(await fetchTeamLogoSvg(teamId)));
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
  clearLikelyTrademarkComponents(context, TEAM_LOGO_SIZE, TEAM_LOGO_SIZE);
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
