export function buildMspCentralRequestUrl(
  requestIdOrNumber: string | undefined,
  baseUrl = process.env.MSP_CENTRAL_REQUEST_WEB_BASE_URL,
) {
  const requestKey = requestIdOrNumber?.trim();
  const configuredBase = baseUrl?.trim();

  if (!requestKey || !configuredBase) {
    return undefined;
  }

  if (configuredBase.includes("{request}")) {
    return configuredBase.replace("{request}", encodeURIComponent(requestKey));
  }

  const separator = configuredBase.includes("?") ? "&" : "?";
  return `${configuredBase}${separator}request=${encodeURIComponent(requestKey)}`;
}
