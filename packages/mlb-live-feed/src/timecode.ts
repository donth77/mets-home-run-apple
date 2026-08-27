import { MLB_TIMECODE_PATTERN } from "./constants";
import { MlbFeedError } from "./errors";

export function assertMlbTimecode(value: string) {
  if (!MLB_TIMECODE_PATTERN.test(value)) {
    throw new MlbFeedError("MLB timecodes must use YYYYMMDD_HHMMSS.", "INVALID_TIMECODE");
  }
}

export function formatMlbTimecode(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new MlbFeedError("Unable to format an invalid MLB timecode date.", "INVALID_TIMECODE_DATE");
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function dateFromMlbTimecode(value: string): Date {
  assertMlbTimecode(value);
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(9, 11)),
      Number(value.slice(11, 13)),
      Number(value.slice(13, 15)),
    ),
  );
}
