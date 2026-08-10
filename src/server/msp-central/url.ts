export function buildMspCentralRequestUrl(
  requestIdOrNumber: string | undefined,
  baseUrl = process.env.MSP_CENTRAL_REQUEST_WEB_BASE_URL,
  portal = process.env.MSP_CENTRAL_PORTAL,
) {
  const requestKey = requestIdOrNumber?.trim();
  const configuredBase = baseUrl?.trim();

  if (!requestKey) {
    return undefined;
  }

  if (!configuredBase) {
    return buildSdpodRequestDetailsUrl(requestKey, portal);
  }

  if (configuredBase.includes("{request}")) {
    return normalizeMspCentralRequestUrl(
      configuredBase.replace("{request}", encodeURIComponent(requestKey)),
      requestKey,
      portal,
    );
  }

  if (looksLikeMspCentralUrl(configuredBase)) {
    const normalizedBaseUrl = normalizeMspCentralRequestUrl(
      configuredBase,
      requestKey,
      portal,
    );
    if (normalizedBaseUrl) {
      return normalizedBaseUrl;
    }
  }

  const separator = configuredBase.includes("?") ? "&" : "?";
  return `${configuredBase}${separator}request=${encodeURIComponent(requestKey)}`;
}

export function normalizeMspCentralRequestUrl(
  url: string | undefined,
  fallbackRequestId?: string,
  fallbackPortal = process.env.MSP_CENTRAL_PORTAL,
) {
  const value = url?.trim();
  if (!value) {
    return buildSdpodRequestDetailsUrl(fallbackRequestId, fallbackPortal);
  }

  const portal =
    value.match(/\/app\/([^/?#]+)/i)?.[1] ??
    fallbackPortal?.trim();
  const requestId =
    value.match(/\/ui\/requests\/([^/?#]+)\/details/i)?.[1] ??
    value.match(/\/Requests\/view\/([^/?#]+)/i)?.[1] ??
    new URLSearchParams(value.split("?")[1] ?? "").get("request") ??
    fallbackRequestId?.trim();

  return buildSdpodRequestDetailsUrl(requestId, portal) ?? value;
}

function buildSdpodRequestDetailsUrl(
  requestIdOrNumber?: string,
  portal?: string,
) {
  const requestKey = requestIdOrNumber?.trim();
  const portalKey = portal?.trim();
  if (!requestKey || !portalKey || !isMspCentralInternalRequestId(requestKey)) {
    return undefined;
  }

  return `https://sdpod.mspcentral.manageengine.com.au/app/${encodeURIComponent(
    portalKey,
  )}/ui/requests/${encodeURIComponent(requestKey)}/details`;
}

function isMspCentralInternalRequestId(value: string) {
  return /^\d{10,}$/.test(value);
}

function looksLikeMspCentralUrl(value: string) {
  return /mspcentral\.manageengine\.com\.au|sdpod\.mspcentral\.manageengine\.com\.au|\/Requests\/view\/|\/ui\/requests\//i.test(
    value,
  );
}
