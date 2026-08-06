import { createHash } from "node:crypto";

export function fingerprintPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(toCanonicalJson(value)))
    .digest("hex");
}

function toCanonicalJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError("Integration payloads must contain only JSON-compatible values.");
  }
  if (Array.isArray(value)) {
    return value.map(toCanonicalJson);
  }
  if (value instanceof Date) {
    return value.toJSON();
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, toCanonicalJson(entry)]),
    );
  }
  throw new TypeError("Integration payloads must contain only JSON-compatible values.");
}

function compareCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
