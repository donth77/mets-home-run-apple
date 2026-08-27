import { isObject, type JsonObject } from "./jsonValue";

export function isFullFeed(value: unknown): value is JsonObject {
  return isObject(value) && isObject(value.gameData) && isObject(value.liveData) && isObject(value.metaData);
}

function isPatchOperation(value: unknown) {
  return isObject(value) && typeof value.op === "string" && typeof value.path === "string";
}

export function patchOperationsFromPayload(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value) && value.length > 0 && value.every(isPatchOperation)) {
    return value;
  }
  const envelopes = Array.isArray(value) ? value : [value];
  const operations: unknown[] = [];
  for (const envelope of envelopes) {
    if (!isObject(envelope) || !Array.isArray(envelope.diff) || !envelope.diff.every(isPatchOperation)) {
      return undefined;
    }
    operations.push(...envelope.diff);
  }
  return operations.length > 0 ? operations : undefined;
}
