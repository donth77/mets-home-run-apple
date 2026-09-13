// Subscription ids are base64url SHA-256 digests, so every id starts with one
// of 64 symbols. A dispatcher shard owns a fixed subset of those symbols and
// walks its subscriptions in primary-key order, one id range at a time. The
// ranges use SQLite's byte-order text comparison, so the alphabet below is in
// byte order. Changing the shard count only re-partitions the symbols; no
// stored row changes.
export const ID_ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

/** `from` is inclusive, `to` is exclusive. */
export interface IdRange {
  from: string;
  to: string;
}

export function shardRanges(shard: number, shards: number): readonly IdRange[] {
  if (!Number.isInteger(shards) || shards < 1) throw new RangeError(`Invalid shard count ${shards}.`);
  if (!Number.isInteger(shard) || shard < 0 || shard >= shards)
    throw new RangeError(`Invalid shard ${shard} of ${shards}.`);
  const ranges: IdRange[] = [];
  for (let index = shard; index < ID_ALPHABET.length; index += shards) {
    const symbol = ID_ALPHABET[index];
    ranges.push({ from: symbol, to: String.fromCharCode(symbol.charCodeAt(0) + 1) });
  }
  return ranges;
}

export function shardName(shard: number) {
  return `shard-${shard}`;
}
