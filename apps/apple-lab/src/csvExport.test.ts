import { describe, expect, it } from "vitest";
import { createCsv } from "./csvExport";

describe("CSV export", () => {
  it("quotes fields and preserves commas, quotes, and newlines", () => {
    const csv = createCsv(
      [{ title: 'Home run, "confirmed"', detail: "Line one\nLine two" }],
      [
        { header: "Title", value: (row) => row.title },
        { header: "Detail", value: (row) => row.detail },
      ],
    );

    expect(csv).toBe('"Title","Detail"\r\n"Home run, ""confirmed""","Line one\nLine two"');
  });

  it("neutralizes spreadsheet formulas in untrusted text", () => {
    const csv = createCsv(
      [{ title: '=HYPERLINK("https://example.test")' }],
      [{ header: "Title", value: (row) => row.title }],
    );

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  });
});
