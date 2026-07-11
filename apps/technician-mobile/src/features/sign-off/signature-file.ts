export function signatureFileName(jobId: string, signedAt: string): string {
  return `signature-${jobId}-${signedAt.replace(/[^a-zA-Z0-9]/g, "-")}.png`;
}

export async function saveSignaturePng({
  jobId,
  signedAt,
}: {
  jobId: string;
  signedAt: string;
  strokePoints: readonly { x: number; y: number }[];
}): Promise<string> {
  return `file:///protected/${signatureFileName(jobId, signedAt)}`;
}
