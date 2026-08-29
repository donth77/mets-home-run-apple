const MLB_STATS_API_ORIGIN = "https://statsapi.mlb.com";
const PROXY_PATH_PREFIX = "/api/mlb";

type FeedRoute = "DIFF" | "FULL" | "SCHEDULE" | "SEASON";

interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
    cacheTtlByStatus?: Record<string, number>;
  };
}

export interface MlbProxyContext {
  request: Request;
}

const queryParameters: Record<FeedRoute, ReadonlySet<string>> = {
  DIFF: new Set(["endTimecode", "startTimecode"]),
  FULL: new Set(["timecode"]),
  SCHEDULE: new Set(["date", "endDate", "hydrate", "sportId", "startDate", "teamId"]),
  SEASON: new Set(["sportId"]),
};

function routeForPath(pathname: string): FeedRoute | undefined {
  if (pathname === "/api/v1/schedule") return "SCHEDULE";
  if (/^\/api\/v1\/seasons\/\d{4}$/.test(pathname)) return "SEASON";
  if (/^\/api\/v1\.1\/game\/\d+\/feed\/live$/.test(pathname)) return "FULL";
  if (/^\/api\/v1\.1\/game\/\d+\/feed\/live\/diffPatch$/.test(pathname)) return "DIFF";
  return undefined;
}

function validDate(value: string | null) {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTimecode(value: string | null) {
  return value === null || /^\d{8}_\d{6}$/.test(value);
}

function queryIsAllowed(url: URL, route: FeedRoute) {
  if ([...url.searchParams.keys()].some((key) => !queryParameters[route].has(key))) return false;
  if (route === "SCHEDULE") {
    if (url.searchParams.get("teamId") !== "121" || url.searchParams.get("sportId") !== "1") return false;
    return (
      validDate(url.searchParams.get("date")) &&
      validDate(url.searchParams.get("startDate")) &&
      validDate(url.searchParams.get("endDate"))
    );
  }
  if (route === "SEASON") return url.searchParams.get("sportId") === "1";
  if (route === "FULL") return validTimecode(url.searchParams.get("timecode"));
  return validTimecode(url.searchParams.get("startTimecode")) && validTimecode(url.searchParams.get("endTimecode"));
}

function edgeCacheSeconds(route: FeedRoute) {
  if (route === "SEASON") return 24 * 60 * 60;
  if (route === "SCHEDULE") return 15;
  return route === "FULL" ? 2 : 1;
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function proxyMlbRequest(context: MlbProxyContext, fetcher: typeof fetch = fetch): Promise<Response> {
  const incomingUrl = new URL(context.request.url);
  if (context.request.method !== "GET") return jsonError("Method not allowed.", 405);
  if (!incomingUrl.pathname.startsWith(`${PROXY_PATH_PREFIX}/`)) return jsonError("Route not found.", 404);

  const upstreamPath = incomingUrl.pathname.slice(PROXY_PATH_PREFIX.length);
  const route = routeForPath(upstreamPath);
  if (!route || !queryIsAllowed(incomingUrl, route)) return jsonError("MLB feed route is not allowed.", 400);

  const upstreamUrl = new URL(`${upstreamPath}${incomingUrl.search}`, MLB_STATS_API_ORIGIN);
  const cacheTtl = edgeCacheSeconds(route);
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetcher(upstreamUrl, {
      headers: { Accept: "application/json" },
      cf: {
        cacheEverything: true,
        cacheTtl,
        cacheTtlByStatus: { "200-299": cacheTtl, "400-599": 0 },
      },
    } as CloudflareRequestInit);
  } catch {
    return jsonError("MLB feed is temporarily unavailable.", 502);
  }

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Mets-Apple-Feed", "edge");
  for (const name of ["etag", "last-modified"]) {
    const value = upstreamResponse.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstreamResponse.body, {
    headers,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  });
}
