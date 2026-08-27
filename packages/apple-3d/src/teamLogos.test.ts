import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTeamLogoSvg } from "./teamLogos";

const svgHeaders = { "content-type": "image/svg+xml" };

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchTeamLogoSvg", () => {
  it("accepts a bounded SVG response and uses a privacy-preserving request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', {
        headers: svgHeaders,
      }),
    );

    await expect(fetchTeamLogoSvg(121, fetcher)).resolves.toContain("<svg");
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.mlbstatic.com/team-logos/121.svg",
      expect.objectContaining({
        cache: "force-cache",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects invalid IDs, response types, active markup, and oversized bodies", async () => {
    const unusedFetcher = vi.fn<typeof fetch>();
    await expect(fetchTeamLogoSvg(0, unusedFetcher)).rejects.toThrow("positive integer");
    expect(unusedFetcher).not.toHaveBeenCalled();

    await expect(
      fetchTeamLogoSvg(
        121,
        vi.fn<typeof fetch>().mockResolvedValue(new Response("not svg", { headers: { "content-type": "text/html" } })),
      ),
    ).rejects.toThrow("not an SVG");

    await expect(
      fetchTeamLogoSvg(
        121,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("<svg><script>alert(1)</script></svg>", { headers: svgHeaders })),
      ),
    ).rejects.toThrow("invalid SVG markup");

    await expect(
      fetchTeamLogoSvg(
        121,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(256 * 1024 + 1), { headers: svgHeaders })),
      ),
    ).rejects.toThrow("maximum size");
  });

  it("aborts a request that exceeds the internal deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );

    const rejection = expect(fetchTeamLogoSvg(121, fetcher)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
  });
});
