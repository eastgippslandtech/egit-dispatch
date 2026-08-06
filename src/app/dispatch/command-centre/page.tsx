import { ProtectedCommandCentreScreen } from "./protected-screen";

export default async function CommandCentrePage({
  searchParams,
}: {
  searchParams?: Promise<{ requestId?: string }>;
} = {}) {
  const requestId = (await searchParams)?.requestId;
  return ProtectedCommandCentreScreen({ selectedRequestId: requestId });
}
