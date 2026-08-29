import { MLB_STATS_API_ORIGIN } from "@apple/mlb-live-feed";

export const MLB_PROXY_PREFIX = "/api/mlb";

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString(), globalThis.location?.href ?? MLB_STATS_API_ORIGIN);
}

export function proxyMlbApiUrl(input: RequestInfo | URL) {
  const url = requestUrl(input);
  if (url.origin !== MLB_STATS_API_ORIGIN) return undefined;
  return `${MLB_PROXY_PREFIX}${url.pathname}${url.search}`;
}

export const mlbApiFetch: typeof fetch = async (input, init) => {
  const proxiedUrl = proxyMlbApiUrl(input);
  if (!proxiedUrl) return fetch(input, init);
  let proxyResponse: Response;
  try {
    proxyResponse = await fetch(input instanceof Request ? new Request(proxiedUrl, input) : proxiedUrl, init);
  } catch (reason) {
    if (init?.signal?.aborted) throw reason;
    return fetch(input, init);
  }
  if (proxyResponse.ok && proxyResponse.headers.get("content-type")?.toLowerCase().includes("json")) {
    return proxyResponse;
  }
  return fetch(input, init);
};
