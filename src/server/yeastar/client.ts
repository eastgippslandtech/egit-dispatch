import type { YeastarConfig } from "./config";

export type YeastarToken = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
};

type TokenStore = {
  load(): Promise<YeastarToken | undefined>;
  save(token: YeastarToken): Promise<void>;
};

class MemoryTokenStore implements TokenStore {
  private token?: YeastarToken;
  async load() {
    return this.token;
  }
  async save(token: YeastarToken) {
    this.token = token;
  }
}

export class YeastarClient {
  private readonly fetchImpl: typeof fetch;
  private readonly tokenStore: TokenStore;

  constructor({
    config,
    fetchImpl = fetch,
    tokenStore = new MemoryTokenStore(),
  }: {
    config: YeastarConfig;
    fetchImpl?: typeof fetch;
    tokenStore?: TokenStore;
  }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.tokenStore = tokenStore;
  }

  private readonly config: YeastarConfig;

  getCdrDetail(uid: string) {
    return this.request<Record<string, unknown>>(
      "/openapi/v2.0/cdr/detail",
      { uid },
    );
  }

  listCdrs(input: { endTime?: string; page?: number; pageSize?: number; startTime?: string } = {}) {
    return this.request<Array<Record<string, unknown>>>(
      "/openapi/v2.0/cdr/search",
      {
        end_time: input.endTime,
        order_by: "asc",
        page: String(input.page ?? 1),
        page_size: String(input.pageSize ?? 200),
        sort_by: "time",
        start_time: input.startTime,
      },
    );
  }

  getAiContext(uid: string) {
    return this.request<Record<string, unknown>>(
      "/openapi/v2.0/cdr/getaicontext",
      { uid },
    );
  }

  getAiSummary(uid: string, callId?: string) {
    return this.request<Record<string, unknown>>(
      "/openapi/v2.0/cdr/getaisummary",
      { call_id: callId, uid },
    );
  }

  private async request<T>(
    path: string,
    parameters: Record<string, string | undefined>,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path, this.config.baseUrl);
    url.searchParams.set("access_token", token);
    for (const [key, value] of Object.entries(parameters)) {
      if (value) url.searchParams.set(key, value);
    }

    const response = await this.fetchImpl(url.toString(), {
      headers: { "User-Agent": this.config.userAgent },
    });
    const payload = await readJson(response);
    assertYeastarSuccess(response, payload);
    return payload.data as T;
  }

  private async getAccessToken() {
    const existing = await this.tokenStore.load();
    if (existing && existing.expiresAt > Date.now() + 60_000) {
      return existing.accessToken;
    }

    const response = await this.fetchImpl(
      new URL("/openapi/v1.0/get_token", this.config.baseUrl),
      {
        body: JSON.stringify({
          password: this.config.clientSecret,
          username: this.config.clientId,
        }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": this.config.userAgent,
        },
        method: "POST",
      },
    );
    const payload = await readJson(response);
    assertYeastarSuccess(response, payload);
    if (typeof payload.access_token !== "string") {
      throw new Error("Yeastar did not return an access token.");
    }
    const now = Date.now();
    const token = {
      accessToken: payload.access_token,
      expiresAt: now + numberValue(payload.access_token_expire_time, 1800) * 1000,
      refreshExpiresAt:
        now + numberValue(payload.refresh_token_expire_time, 86400) * 1000,
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : undefined,
    };
    await this.tokenStore.save(token);
    return token.accessToken;
  }
}

async function readJson(response: Response) {
  const value = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  return value ?? {};
}

function assertYeastarSuccess(
  response: Response,
  payload: Record<string, unknown>,
) {
  if (!response.ok || (typeof payload.errcode === "number" && payload.errcode !== 0)) {
    const message =
      typeof payload.errmsg === "string" ? payload.errmsg : "Request failed";
    throw new Error(`Yeastar API request failed (${response.status}): ${message}`);
  }
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
