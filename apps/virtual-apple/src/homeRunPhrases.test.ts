import { describe, expect, it } from "vitest";
import { HOME_RUN_PHRASE_TEMPLATES, selectHomeRunPhrase } from "./homeRunPhrases";

describe("home-run phrases", () => {
  it("provides a varied pool of unique phrases", () => {
    expect(HOME_RUN_PHRASE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(HOME_RUN_PHRASE_TEMPLATES).size).toBe(HOME_RUN_PHRASE_TEMPLATES.length);
    expect(HOME_RUN_PHRASE_TEMPLATES.every((phrase) => !phrase.includes("—"))).toBe(true);
  });

  it("selects across the full pool and inserts the batter", () => {
    expect(selectHomeRunPhrase("Juan Soto", 0)).toBe(
      "Juan Soto sends one out, and the Home Run Apple is rising in center field!",
    );
    expect(selectHomeRunPhrase("Bo Bichette", 0.999999)).toBe(
      "Bo Bichette sends it over the fence, and up comes the Home Run Apple!",
    );
  });

  it("uses a generic hitter label when the batter is unavailable", () => {
    expect(selectHomeRunPhrase("", 0)).toContain("A Mets hitter");
  });
});
