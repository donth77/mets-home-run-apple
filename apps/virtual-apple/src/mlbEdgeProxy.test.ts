import { describe, expect, it, vi } from "vitest";
import { proxyMlbRequest } from "./mlbEdgeProxy";

function request(path: string, method = "GET") {
  return new Request(`https://metsapple.com${path}`, { method });
}

describe("Virtual Apple edge feed", () => {
  it("forwards an allowed Mets schedule request with short edge caching", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { dates: [] },
        {
          headers: { etag: '"schedule"' },
        },
      ),
    );

    const response = await proxyMlbRequest(
      {
        request: request("/api/mlb/api/v1/schedule?sportId=1&teamId=121&date=2026-08-28&hydrate=team"),
      },
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-mets-apple-feed")).toBe("edge");
    expect(response.headers.get("etag")).toBe('"schedule"');
    expect(fetcher.mock.calls[0][0].toString()).toBe(
      "https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=121&date=2026-08-28&hydrate=team",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cf: { cacheEverything: true, cacheTtl: 15 },
      headers: { Accept: "application/json" },
    });
  });

  it("forwards a bounded live diff request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const response = await proxyMlbRequest(
      {
        request: request(
          "/api/mlb/api/v1.1/game/823583/feed/live/diffPatch?startTimecode=20260828_220000&endTimecode=20260828_220010",
        ),
      },
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cf: { cacheEverything: true, cacheTtl: 1 } });
  });

  it("rejects non-Mets schedules, unknown endpoints, and non-GET requests", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      proxyMlbRequest(
        { request: request("/api/mlb/api/v1/schedule?sportId=1&teamId=147&date=2026-08-28") },
        fetcher,
      ).then((response) => response.status),
    ).resolves.toBe(400);
    await expect(
      proxyMlbRequest({ request: request("/api/mlb/api/v1/people/1") }, fetcher).then((response) => response.status),
    ).resolves.toBe(400);
    await expect(
      proxyMlbRequest(
        { request: request("/api/mlb/api/v1/schedule?sportId=1&teamId=121&date=2026-08-28", "POST") },
        fetcher,
      ).then((response) => response.status),
    ).resolves.toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a safe temporary failure when MLB cannot be reached", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed"));
    const response = await proxyMlbRequest(
      {
        request: request("/api/mlb/api/v1.1/game/823583/feed/live"),
      },
      fetcher,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "MLB feed is temporarily unavailable." });
  });
});
