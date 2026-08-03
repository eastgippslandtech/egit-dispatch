import { createHash } from "node:crypto";

export function fingerprintPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortForJson(value)))
    .digest("hex");
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortForJson(entry)]),
    );
  }
  return value;
}
