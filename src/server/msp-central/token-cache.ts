import { createHash } from "node:crypto";

import { MspCentralConfigurationError } from "./errors";

const DEFAULT_REFRESH_BUFFER_MS = 60_000;
const DEFAULT_REFRESH_LEASE_MS = 15_000;
const DEFAULT_THROTTLE_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 6_000;

export type SharedMspOAuthToken = {
  accessToken: string;
  expiresAt: number;
};

export interface MspOAuthTokenStore {
  blockRefresh(cacheKey: string, blockedUntil: number): Promise<void>;
  getRefreshBlockedUntil(cacheKey: string): Promise<number | null>;
  getToken(cacheKey: string): Promise<SharedMspOAuthToken | null>;
  invalidateToken(cacheKey: string, rejectedAccessToken: string): Promise<void>;
  releaseRefreshLease(cacheKey: string): Promise<void>;
  saveToken(cacheKey: string, token: SharedMspOAuthToken): Promise<void>;
  tryAcquireRefreshLease(
    cacheKey: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean>;
}

type RefreshedMspOAuthToken = {
  accessToken: string;
  expiresInSeconds: number;
};

type LocalTokenEntry = {
  accessToken?: string;
  blockedUntil?: number;
  expiresAt?: number;
  lastError?: Error;
  refreshPromise?: Promise<string>;
};

type CoordinatorOptions = {
  now?: () => number;
  refreshBufferMs?: number;
  refreshLeaseMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  store?: MspOAuthTokenStore | null;
  throttleCooldownMs?: number;
  waitIntervalMs?: number;
  waitTimeoutMs?: number;
};

export class MspOAuthAccessTokenCoordinator {
  private readonly entries = new Map<string, LocalTokenEntry>();
  private readonly now: () => number;
  private readonly refreshBufferMs: number;
  private readonly refreshLeaseMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly store: MspOAuthTokenStore | null;
  private readonly throttleCooldownMs: number;
  private readonly waitIntervalMs: number;
  private readonly waitTimeoutMs: number;

  constructor({
    now = Date.now,
    refreshBufferMs = DEFAULT_REFRESH_BUFFER_MS,
    refreshLeaseMs = DEFAULT_REFRESH_LEASE_MS,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    store = null,
    throttleCooldownMs = DEFAULT_THROTTLE_COOLDOWN_MS,
    waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  }: CoordinatorOptions = {}) {
    this.now = now;
    this.refreshBufferMs = refreshBufferMs;
    this.refreshLeaseMs = refreshLeaseMs;
    this.sleep = sleep;
    this.store = store;
    this.throttleCooldownMs = throttleCooldownMs;
    this.waitIntervalMs = waitIntervalMs;
    this.waitTimeoutMs = waitTimeoutMs;
  }

  async getToken(
    cacheKey: string,
    refresh: () => Promise<RefreshedMspOAuthToken>,
  ) {
    const entry = this.entries.get(cacheKey) ?? {};
    this.entries.set(cacheKey, entry);
    const now = this.now();

    if (!this.store && isFresh(entry, now, this.refreshBufferMs)) {
      return entry.accessToken as string;
    }

    if (entry.refreshPromise) {
      return entry.refreshPromise;
    }

    if (entry.blockedUntil && now < entry.blockedUntil && entry.lastError) {
      if (isValid(entry, now)) {
        return entry.accessToken as string;
      }

      throw entry.lastError;
    }

    const stillValidToken = isValid(entry, now)
      ? entry.accessToken
      : undefined;

    entry.refreshPromise = this.loadOrRefresh(cacheKey, entry, refresh)
      .catch((error: unknown) => {
        const safeError =
          error instanceof Error
            ? error
            : new MspCentralConfigurationError(
                "MSP Central OAuth refresh failed.",
              );
        entry.lastError = safeError;

        if (isAccessDenied(safeError)) {
          entry.blockedUntil = this.now() + this.throttleCooldownMs;
        }

        if (stillValidToken && isAccessDenied(safeError)) {
          return stillValidToken;
        }

        throw safeError;
      })
      .finally(() => {
        entry.refreshPromise = undefined;
      });

    return entry.refreshPromise;
  }

  async invalidate(cacheKey: string, rejectedAccessToken: string) {
    const entry = this.entries.get(cacheKey);
    if (entry?.accessToken === rejectedAccessToken) {
      entry.accessToken = undefined;
      entry.expiresAt = undefined;
      entry.blockedUntil = undefined;
      entry.lastError = undefined;
    }

    if (!this.store) {
      return;
    }

    try {
      await this.store.invalidateToken(cacheKey, rejectedAccessToken);
    } catch {
      // The request can recover through the local cache if shared storage is down.
    }
  }

  reset() {
    this.entries.clear();
  }

  private async loadOrRefresh(
    cacheKey: string,
    entry: LocalTokenEntry,
    refresh: () => Promise<RefreshedMspOAuthToken>,
  ) {
    if (!this.store) {
      return this.refreshAndSaveLocally(entry, refresh);
    }

    let blockedUntil: number | null;
    let sharedToken: SharedMspOAuthToken | null;
    try {
      [blockedUntil, sharedToken] = await Promise.all([
        this.store.getRefreshBlockedUntil(cacheKey),
        this.store.getToken(cacheKey),
      ]);
    } catch {
      return this.refreshAndSaveLocally(entry, refresh);
    }

    if (sharedToken && isFresh(sharedToken, this.now(), this.refreshBufferMs)) {
      copyToken(entry, sharedToken);
      return sharedToken.accessToken;
    }

    if (blockedUntil && blockedUntil > this.now()) {
      if (sharedToken && isValid(sharedToken, this.now())) {
        copyToken(entry, sharedToken);
        return sharedToken.accessToken;
      }

      throw throttledRefreshError();
    }

    let acquired: boolean;
    try {
      acquired = await this.store.tryAcquireRefreshLease(
        cacheKey,
        this.now(),
        this.now() + this.refreshLeaseMs,
      );
    } catch {
      return this.refreshAndSaveLocally(entry, refresh);
    }

    if (acquired) {
      return this.refreshAndSaveShared(cacheKey, entry, refresh);
    }

    return this.waitForSharedRefresh(cacheKey, entry, refresh);
  }

  private async refreshAndSaveLocally(
    entry: LocalTokenEntry,
    refresh: () => Promise<RefreshedMspOAuthToken>,
  ) {
    const refreshed = await refresh();
    const token = {
      accessToken: refreshed.accessToken,
      expiresAt: this.now() + refreshed.expiresInSeconds * 1000,
    };
    copyToken(entry, token);
    return token.accessToken;
  }

  private async refreshAndSaveShared(
    cacheKey: string,
    entry: LocalTokenEntry,
    refresh: () => Promise<RefreshedMspOAuthToken>,
  ) {
    try {
      const refreshed = await refresh();
      const token = {
        accessToken: refreshed.accessToken,
        expiresAt: this.now() + refreshed.expiresInSeconds * 1000,
      };
      copyToken(entry, token);

      try {
        await this.store?.saveToken(cacheKey, token);
      } catch {
        // Keep serving the freshly issued local token.
      }

      return token.accessToken;
    } catch (error) {
      try {
        if (error instanceof Error && isAccessDenied(error)) {
          await this.store?.blockRefresh(
            cacheKey,
            this.now() + this.throttleCooldownMs,
          );
        } else {
          await this.store?.releaseRefreshLease(cacheKey);
        }
      } catch {
        // The lease expires automatically.
      }
      throw error;
    }
  }

  private async waitForSharedRefresh(
    cacheKey: string,
    entry: LocalTokenEntry,
    refresh: () => Promise<RefreshedMspOAuthToken>,
  ) {
    const deadline = this.now() + this.waitTimeoutMs;

    while (this.now() < deadline) {
      await this.sleep(this.waitIntervalMs);
      let blockedUntil: number | null | undefined;
      let token: SharedMspOAuthToken | null | undefined;
      try {
        [blockedUntil, token] = await Promise.all([
          this.store?.getRefreshBlockedUntil(cacheKey),
          this.store?.getToken(cacheKey),
        ]);
      } catch {
        return this.refreshAndSaveLocally(entry, refresh);
      }

      if (token && isFresh(token, this.now(), this.refreshBufferMs)) {
        copyToken(entry, token);
        return token.accessToken;
      }
      if (blockedUntil && blockedUntil > this.now()) {
        throw throttledRefreshError();
      }
    }

    let acquired: boolean | undefined;
    try {
      acquired = await this.store?.tryAcquireRefreshLease(
        cacheKey,
        this.now(),
        this.now() + this.refreshLeaseMs,
      );
    } catch {
      return this.refreshAndSaveLocally(entry, refresh);
    }
    if (acquired) {
      return this.refreshAndSaveShared(cacheKey, entry, refresh);
    }

    throw new MspCentralConfigurationError(
      "MSP Central OAuth refresh is already in progress.",
    );
  }
}

export function buildMspOAuthCacheKey({
  accountsUrl,
  clientId,
  refreshToken,
}: {
  accountsUrl?: string;
  clientId?: string;
  refreshToken?: string;
}) {
  return createHash("sha256")
    .update([accountsUrl, clientId, refreshToken].join("\n"))
    .digest("hex");
}

function copyToken(entry: LocalTokenEntry, token: SharedMspOAuthToken) {
  entry.accessToken = token.accessToken;
  entry.expiresAt = token.expiresAt;
  entry.blockedUntil = undefined;
  entry.lastError = undefined;
}

function isFresh(
  token: { accessToken?: string; expiresAt?: number },
  now: number,
  refreshBufferMs: number,
) {
  return Boolean(
    token.accessToken &&
      token.expiresAt &&
      now < token.expiresAt - refreshBufferMs,
  );
}

function isValid(
  token: { accessToken?: string; expiresAt?: number },
  now: number,
) {
  return Boolean(token.accessToken && token.expiresAt && now < token.expiresAt);
}

function isAccessDenied(error: Error) {
  return error.message.toLowerCase().includes("access denied");
}

function throttledRefreshError() {
  return new MspCentralConfigurationError(
    "MSP Central OAuth refresh is temporarily throttled.",
  );
}
