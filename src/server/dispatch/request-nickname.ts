export function normalizeRequestNickname(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Ticket nickname must be a string or null.");
  }

  const nickname = value.trim().replace(/\s+/g, " ");
  if (nickname.length > 80) {
    throw new Error("Ticket nickname must be 80 characters or fewer.");
  }
  return nickname || null;
}
