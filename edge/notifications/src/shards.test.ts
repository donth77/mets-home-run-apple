import { describe, expect, it } from "vitest";
import { ID_ALPHABET, shardRanges } from "./shards";

describe("shardRanges", () => {
  it("is in byte order so SQLite range scans match", () => {
    for (let index = 1; index < ID_ALPHABET.length; index += 1) {
      expect(ID_ALPHABET.charCodeAt(index)).toBeGreaterThan(ID_ALPHABET.charCodeAt(index - 1));
    }
  });

  it("covers every id symbol exactly once across the shards", () => {
    for (const shards of [1, 3, 4, 8]) {
      const seen = new Map<string, number>();
      for (let shard = 0; shard < shards; shard += 1) {
        for (const range of shardRanges(shard, shards)) {
          expect(range.to.charCodeAt(0)).toBe(range.from.charCodeAt(0) + 1);
          seen.set(range.from, (seen.get(range.from) ?? 0) + 1);
        }
      }
      expect([...seen.keys()].sort().join("")).toBe([...ID_ALPHABET].sort().join(""));
      expect([...seen.values()].every((count) => count === 1)).toBe(true);
    }
  });

  it("rejects an invalid shard", () => {
    expect(() => shardRanges(4, 4)).toThrow(RangeError);
    expect(() => shardRanges(0, 0)).toThrow(RangeError);
  });
});
