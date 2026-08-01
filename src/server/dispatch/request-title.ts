const LEADING_NUMERIC_REQUEST =
  /^(?:(?:REQ(?:UEST)?|SDP|TICKET)\s*[-#:]?\s*)?\d{6,}(?:\s*[-:|]\s*|\s+)/i;

export function cleanRequestTitle(
  title?: string | null,
  requestNumber?: string | null,
) {
  const value = title?.trim() ?? "";

  if (!value) {
    return "";
  }

  const exactRequestNumber = requestNumber?.trim();
  if (exactRequestNumber) {
    const exactPrefix = new RegExp(
      `^${escapeRegExp(exactRequestNumber)}(?:\\s*[-:|]\\s*|\\s+)`,
      "i",
    );
    const exactCleaned = value.replace(exactPrefix, "").trim();

    if (exactCleaned !== value) {
      return exactCleaned;
    }
  }

  return value.replace(LEADING_NUMERIC_REQUEST, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
