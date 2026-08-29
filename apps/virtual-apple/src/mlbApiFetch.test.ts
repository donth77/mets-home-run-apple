import { afterEach, describe, expect, it, vi } from "vitest";
import { mlbApiFetch, proxyMlbApiUrl } from "./mlbApiFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Virtual Apple MLB transport", () => {
  it("rewrites official MLB API requests through the same-origin route", () => {
    expect(
      proxyMlbApiUrl("https://statsapi.mlb.com/api/v1.1/game/823583/feed/live/diffPatch?startTimecode=20260828_220000"),
    ).toBe("/api/mlb/api/v1.1/game/823583/feed/live/diffPatch?startTimecode=20260828_220000");
  });

  it("does not rewrite unrelated requests", () => {
    expect(proxyMlbApiUrl("https://example.com/data.json")).toBeUndefined();
  });

  it("preserves request options while using the proxy", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();

    await mlbApiFetch("https://statsapi.mlb.com/api/v1/schedule?teamId=121", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/mlb/api/v1/schedule?teamId=121", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  });

  it("falls back to MLB directly if the edge route is unavailable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ dates: [] }));
    vi.stubGlobal("fetch", fetcher);

    const response = await mlbApiFetch("https://statsapi.mlb.com/api/v1/schedule?teamId=121");

    expect(await response.json()).toEqual({ dates: [] });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/mlb/api/v1/schedule?teamId=121", undefined);
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://statsapi.mlb.com/api/v1/schedule?teamId=121", undefined);
  });
});
