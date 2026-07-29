import type {
  GraphCalendarRange,
  MicrosoftGraphEvent,
  MicrosoftGraphEventDraft,
  MicrosoftGraphEventUpdate,
} from "./types";

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

type GetCalendarEventInput = {
  eventId: string;
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
  let accessTokenPromise: Promise<string> | undefined;

  function acquireToken() {
    accessTokenPromise ??= requestAccessToken();
    return accessTokenPromise;
  }

  async function requestAccessToken() {
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
    let nextUrl: string | undefined =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userPrincipalName,
      )}/calendar/calendarView?${params.toString()}`;
    const events: MicrosoftGraphEvent[] = [];
    const visitedUrls = new Set<string>();

    while (nextUrl) {
      if (visitedUrls.has(nextUrl) || visitedUrls.size >= 100) {
        throw new GraphApiError(
          `Microsoft Graph calendar pagination failed for ${userPrincipalName}.`,
        );
      }
      visitedUrls.add(nextUrl);

      const response = await fetchImpl(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: `outlook.timezone="${outlookTimezone}"`,
        },
        method: "GET",
      });

      if (!response.ok) {
        throw new GraphApiError(
          `Microsoft Graph calendar read failed for ${userPrincipalName}.`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        "@odata.nextLink"?: string;
        value?: MicrosoftGraphEvent[];
      };
      events.push(...(payload.value ?? []));
      nextUrl = trustedGraphNextLink(payload["@odata.nextLink"]);
    }

    return events;
  }

  async function getEvent({
    eventId,
    userPrincipalName,
  }: GetCalendarEventInput) {
    const token = await acquireToken();
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userPrincipalName,
      )}/events/${encodeURIComponent(eventId)}`,
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
        `Microsoft Graph calendar event read failed for ${userPrincipalName}.`,
        response.status,
      );
    }

    return (await response.json()) as MicrosoftGraphEvent;
  }

  async function createEvent(input: MicrosoftGraphEventDraft) {
    const token = await acquireToken();
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        input.userPrincipalName,
      )}/events`,
      {
        body: JSON.stringify(graphEventBody(input, outlookTimezone)),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: `outlook.timezone="${outlookTimezone}"`,
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new GraphApiError(
        `Microsoft Graph calendar create failed for ${input.userPrincipalName}.`,
        response.status,
      );
    }

    return (await response.json()) as MicrosoftGraphEvent;
  }

  async function updateEvent(input: MicrosoftGraphEventUpdate) {
    const token = await acquireToken();
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        input.userPrincipalName,
      )}/events/${encodeURIComponent(input.eventId)}`,
      {
        body: JSON.stringify(graphEventBody(input, outlookTimezone)),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: `outlook.timezone="${outlookTimezone}"`,
        },
        method: "PATCH",
      },
    );

    if (!response.ok) {
      throw new GraphApiError(
        `Microsoft Graph calendar update failed for ${input.userPrincipalName}.`,
        response.status,
      );
    }

    return (await response.json()) as MicrosoftGraphEvent;
  }

  return {
    acquireToken,
    createEvent,
    getEvent,
    listCalendarView,
    updateEvent,
  };
}

function trustedGraphNextLink(nextLink?: string) {
  if (!nextLink) {
    return undefined;
  }

  try {
    const url = new URL(nextLink);
    if (url.protocol === "https:" && url.hostname === "graph.microsoft.com") {
      return url.toString();
    }
  } catch {
    // Fall through to a safe Graph error without sending the access token.
  }

  throw new GraphApiError("Microsoft Graph calendar pagination link was invalid.");
}

function graphEventBody(input: MicrosoftGraphEventDraft, timezone: string) {
  return {
    body: input.bodyPreview
      ? {
          content: input.bodyPreview,
          contentType: "text",
        }
      : undefined,
    end: {
      dateTime: input.end,
      timeZone: timezone,
    },
    location: input.location
      ? {
          displayName: input.location,
        }
      : undefined,
    start: {
      dateTime: input.start,
      timeZone: timezone,
    },
    subject: input.subject,
  };
}
