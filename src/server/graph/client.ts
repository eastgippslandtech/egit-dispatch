import type { GraphCalendarRange, MicrosoftGraphEvent } from "./types";

type FetchLike = typeof fetch;

type GraphClientOptions = {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: FetchLike;
  tenantId?: string;
  timezone?: string;
};

type ListCalendarViewInput = GraphCalendarRange & {
  userPrincipalName: string;
};

export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

export function createGraphClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  tenantId,
  timezone = "AUS Eastern Standard Time",
}: GraphClientOptions) {
  const outlookTimezone =
    timezone === "Australia/Melbourne" ? "AUS Eastern Standard Time" : timezone;
  async function acquireToken() {
    if (!tenantId || !clientId || !clientSecret) {
      throw new GraphApiError("Microsoft Graph credentials are not configured.");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(
        tenantId,
      )}/oauth2/v2.0/token`,
      {
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new GraphApiError("Microsoft Graph token request failed.", response.status);
    }

    const payload = (await response.json()) as { access_token?: string };

    if (!payload.access_token) {
      throw new GraphApiError("Microsoft Graph token response was incomplete.");
    }

    return payload.access_token;
  }

  async function listCalendarView({
    endDateTime,
    startDateTime,
    userPrincipalName,
  }: ListCalendarViewInput) {
    const token = await acquireToken();
    const params = new URLSearchParams({ startDateTime, endDateTime });
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userPrincipalName,
      )}/calendar/calendarView?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: `outlook.timezone="${outlookTimezone}"`,
        },
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new GraphApiError(
        `Microsoft Graph calendar read failed for ${userPrincipalName}.`,
        response.status,
      );
    }

    const payload = (await response.json()) as { value?: MicrosoftGraphEvent[] };
    return payload.value ?? [];
  }

  return {
    acquireToken,
    listCalendarView,
  };
}
