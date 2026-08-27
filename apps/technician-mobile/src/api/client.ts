import type { QueuedMutation } from "../features/sync/mutation-queue";

export interface ApiClientOptions {
  accessToken: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  requestId?: () => string;
  refreshAccessToken?: () => Promise<string | null>;
}

export interface ApiRequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

export interface ApiClient {
  request<TResponse = unknown>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<TResponse>;
  sendMutation<TResponse = unknown>(
    mutation: QueuedMutation,
  ): Promise<TResponse>;
}

export function createApiClient({
  accessToken,
  baseUrl,
  fetcher = fetch,
  requestId = createRequestId,
  refreshAccessToken,
}: ApiClientOptions): ApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  let currentAccessToken = accessToken;

  return {
    async request<TResponse = unknown>(
      path: string,
      options: ApiRequestOptions = {},
    ): Promise<TResponse> {
      const url = `${normalizedBaseUrl}${normalizePath(path)}`;
      const response = await fetcher(url, buildRequestInit({
        accessToken: currentAccessToken,
        options,
        requestId: requestId(),
      }));

      if (response.status === 401 && refreshAccessToken) {
        const refreshedAccessToken = await refreshAccessToken();
        if (refreshedAccessToken) {
          currentAccessToken = refreshedAccessToken;
          const retryResponse = await fetcher(url, buildRequestInit({
            accessToken: currentAccessToken,
            options,
            requestId: requestId(),
          }));

          if (retryResponse.ok) {
            return (await retryResponse.json()) as TResponse;
          }

          throw new MobileApiError(
            `Mobile API request failed with ${retryResponse.status}.`,
            retryResponse.status,
          );
        }
      }

      if (!response.ok) {
        throw new MobileApiError(
          `Mobile API request failed with ${response.status}.`,
          response.status,
        );
      }

      return (await response.json()) as TResponse;
    },

    async sendMutation<TResponse = unknown>(
      mutation: QueuedMutation,
    ): Promise<TResponse> {
      return this.request<TResponse>(
        mutationPath(mutation),
        {
          body: mutation.payload,
          idempotencyKey: mutation.id,
          method: "POST",
        },
      );
    },
  };
}

function mutationPath(mutation: QueuedMutation): string {
  const jobPath = `/jobs/${encodeURIComponent(mutation.jobId)}`;
  switch (mutation.actionType) {
    case "timer-start":
      return `${jobPath}/timer/start`;
    case "timer-stop":
      return `${jobPath}/timer/stop`;
    default:
      return `${jobPath}/${encodeURIComponent(mutation.actionType)}`;
  }
}

function buildRequestInit({
  accessToken,
  options,
  requestId,
}: {
  accessToken: string;
  options: ApiRequestOptions;
  requestId: string;
}): RequestInit {
  return {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: createHeaders({
      accessToken,
      idempotencyKey: options.idempotencyKey,
      requestId,
    }),
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
  };
}

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export function redactApiSecret(value: string): string {
  if (value.length <= 8) {
    return "••••";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function createHeaders({
  accessToken,
  idempotencyKey,
  requestId,
}: {
  accessToken: string;
  idempotencyKey?: string;
  requestId: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return headers;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function createRequestId(): string {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
