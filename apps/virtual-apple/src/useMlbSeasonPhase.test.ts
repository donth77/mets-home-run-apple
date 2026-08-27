import { describe, expect, it, vi } from "vitest";
import { fetchMlbSeasonDates, offseasonWindowForDate, type MlbSeasonDates } from "@apple/mlb-live-feed";

const seasons: readonly MlbSeasonDates[] = [
  { seasonId: 2025, springStartDate: "2025-02-20", offseasonStartDate: "2025-11-02" },
  { seasonId: 2026, springStartDate: "2026-02-20", offseasonStartDate: "2026-11-01" },
  { seasonId: 2027, springStartDate: "2027-02-20", offseasonStartDate: "2027-11-01" },
];

describe("MLB season phase", () => {
  it("enters offseason on MLB's offseason date", () => {
    expect(offseasonWindowForDate("2026-10-31", seasons)).toBeUndefined();
    expect(offseasonWindowForDate("2026-11-01", seasons)).toEqual({
      startDate: "2026-11-01",
      endDate: "2027-02-20",
      previousSeasonId: 2026,
      nextSeasonId: 2027,
    });
  });

  it("leaves offseason automatically on the next spring start date", () => {
    expect(offseasonWindowForDate("2027-02-19", seasons)).toBeDefined();
    expect(offseasonWindowForDate("2027-02-20", seasons)).toBeUndefined();
  });

  it("recognizes the prior season window after New Year's Day", () => {
    expect(offseasonWindowForDate("2026-01-15", seasons)).toMatchObject({
      previousSeasonId: 2025,
      nextSeasonId: 2026,
    });
  });

  it("parses season boundaries from the official MLB response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          seasons: [
            {
              seasonId: "2027",
              springStartDate: "2027-02-20",
              offseasonStartDate: "2027-11-01",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(fetchMlbSeasonDates(2027, fetcher)).resolves.toEqual(seasons[2]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("https://statsapi.mlb.com/api/v1/seasons/2027?sportId=1");
  });
});
