import type {
  GraphCalendarRange,
  MicrosoftGraphEvent,
  MicrosoftGraphEventDraft,
  MicrosoftGraphEventUpdate,
  MicrosoftGraphSendMailInput,
} from "./types";

type FetchLike = typeof fetch;

const GRAPH_REQUEST_TIMEOUT_MS = 6_000;
const GRAPH_CALENDAR_SELECT = [
  "attendees",
  "bodyPreview",
  "categories",
  "end",
  "id",
  "isAllDay",
  "lastModifiedDateTime",
  "location",
  "organizer",
  "sensitivity",
  "showAs",
  "start",
  "subject",
  "webLink",
].join(",");

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
        signal: requestSignal(),
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
    const params = new URLSearchParams({
      "$select": GRAPH_CALENDAR_SELECT,
      "$top": "50",
      endDateTime,
      startDateTime,
    });
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
        signal: requestSignal(),
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
        signal: requestSignal(),
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

  async function deleteEvent({
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
        },
        method: "DELETE",
        signal: requestSignal(),
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new GraphApiError(
        `Microsoft Graph calendar delete failed for ${userPrincipalName}.`,
        response.status,
      );
    }
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
        signal: requestSignal(),
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
        signal: requestSignal(),
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

  async function sendMail(input: MicrosoftGraphSendMailInput) {
    const token = await acquireToken();
    ensureTokenHasAppRole(
      token,
      "Mail.Send",
      "Microsoft Graph Mail.Send application permission is not granted for technician email.",
    );
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        input.fromUserPrincipalName,
      )}/sendMail`,
      {
        body: JSON.stringify(graphMailBody(input)),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: requestSignal(),
      },
    );

    if (!response.ok) {
      throw new GraphApiError(
        `Microsoft Graph mail send failed for ${input.to}.`,
        response.status,
      );
    }

    return { id: response.headers?.get("request-id") ?? undefined };
  }

  return {
    acquireToken,
    createEvent,
    deleteEvent,
    getEvent,
    listCalendarView,
    sendMail,
    updateEvent,
  };
}

function ensureTokenHasAppRole(token: string, role: string, message: string) {
  const roles = graphTokenRoles(token);
  if (roles && !roles.includes(role)) {
    throw new GraphApiError(message);
  }
}

function graphTokenRoles(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { roles?: unknown };
    return Array.isArray(parsed.roles)
      ? parsed.roles.filter((role): role is string => typeof role === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

function requestSignal() {
  return AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS);
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
    transactionId: input.transactionId,
  };
}

function graphMailBody(input: MicrosoftGraphSendMailInput) {
  return {
    message: {
      body: {
        content: input.html ?? input.plainText,
        contentType: input.html ? "HTML" : "Text",
      },
      subject: input.subject,
      toRecipients: [
        {
          emailAddress: {
            address: input.to,
          },
        },
      ],
    },
    saveToSentItems: true,
  };
}
