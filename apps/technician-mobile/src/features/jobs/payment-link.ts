export function buildPaymentUrl({
  baseUrl,
  customerName,
  requestNumber,
}: {
  baseUrl: string;
  customerName: string | null;
  requestNumber: string | null;
}): string | null {
  if (!requestNumber || !customerName) {
    return null;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  params.set("jobNumber", requestNumber);
  params.set("customerName", customerName);
  return `${baseUrl}${separator}${params.toString()}`;
}
