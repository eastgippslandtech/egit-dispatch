export function buildPaymentUrl({
  baseUrl,
  customerName,
  requestNumber,
}: {
  baseUrl: string;
  customerName: string | null;
  requestNumber: string | null;
}) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  if (requestNumber) params.set("jobNumber", requestNumber);
  if (customerName) params.set("customerName", customerName);
  return `${baseUrl}${separator}${params.toString()}`;
}
