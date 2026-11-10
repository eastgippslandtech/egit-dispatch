import type { DispatchDashboardData } from "./types";
import { getConfiguredRequestNicknameRepository } from "./request-nickname-repository";

export async function withStoredRequestNicknames(
  dashboard: DispatchDashboardData,
): Promise<DispatchDashboardData> {
  const repository = getConfiguredRequestNicknameRepository();
  if (!repository || dashboard.requests.length === 0) return dashboard;

  try {
    const nicknames = await repository.list(dashboard.requests.map((request) => request.id));
    return {
      ...dashboard,
      requests: dashboard.requests.map((request) => ({
        ...request,
        nickname: nicknames[request.id],
      })),
    };
  } catch (error) {
    console.error("Ticket nicknames could not be loaded", error);
    return dashboard;
  }
}
