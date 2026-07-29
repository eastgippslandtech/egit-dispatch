import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildMspOAuthCacheKey,
  MspOAuthAccessTokenCoordinator,
  type MspOAuthTokenStore,
  type SharedMspOAuthToken,
} from "./token-cache";

class MemoryTokenStore implements MspOAuthTokenStore {
  private leaseUntil = 0;
  private refreshBlockedUntil = 0;
  private token: SharedMspOAuthToken | null = null;

  async blockRefresh(_cacheKey: string, blockedUntil: number) {
    this.refreshBlockedUntil = blockedUntil;
    this.leaseUntil = 0;
  }

  async getRefreshBlockedUntil() {
    return this.refreshBlockedUntil || null;
  }

  async getToken() {
    return this.token;
  }

  async invalidateToken(_cacheKey: string, rejectedAccessToken: string) {
    if (this.token?.accessToken === rejectedAccessToken) {
      this.token = null;
    }
  }

  async releaseRefreshLease() {
    this.leaseUntil = 0;
  }

  async saveToken(_cacheKey: string, token: SharedMspOAuthToken) {
    this.token = token;
    this.leaseUntil = 0;
    this.refreshBlockedUntil = 0;
  }

  async tryAcquireRefreshLease(
    _cacheKey: string,
    now: number,
    leaseUntil: number,
  ) {
    if (this.leaseUntil > now) {
      return false;
    }

    this.leaseUntil = leaseUntil;
    return true;
  }
}

describe("MSP Central shared OAuth token coordinator", () => {
  it("shares one Zoho refresh across isolated server instances", async () => {
    const store = new MemoryTokenStore();
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        accessToken: "shared-access-token",
        expiresInSeconds: 3600,
      };
    });
    const firstInstance = new MspOAuthAccessTokenCoordinator({
      store,
      waitIntervalMs: 1,
      waitTimeoutMs: 100,
    });
    const secondInstance = new MspOAuthAccessTokenCoordinator({
      store,
      waitIntervalMs: 1,
      waitTimeoutMs: 100,
    });

    const tokens = await Promise.all([
      firstInstance.getToken("shared-key", refresh),
      secondInstance.getToken("shared-key", refresh),
    ]);

    expect(tokens).toEqual(["shared-access-token", "shared-access-token"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reuses a valid database token without contacting Zoho", async () => {
    const store = new MemoryTokenStore();
    await store.saveToken("shared-key", {
      accessToken: "database-access-token",
      expiresAt: Date.now() + 3_600_000,
    });
    const refresh = vi.fn();
    const coordinator = new MspOAuthAccessTokenCoordinator({ store });

    await expect(coordinator.getToken("shared-key", refresh)).resolves.toBe(
      "database-access-token",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not bypass a shared cooldown with a token cached by a warm instance", async () => {
    const now = Date.now();
    const store = new MemoryTokenStore();
    await store.saveToken("shared-key", {
      accessToken: "now-rejected-access-token",
      expiresAt: now + 3_600_000,
    });
    const refresh = vi.fn();
    const coordinator = new MspOAuthAccessTokenCoordinator({
      now: () => now,
      store,
    });

    await coordinator.getToken("shared-key", refresh);
    await store.invalidateToken("shared-key", "now-rejected-access-token");
    await store.blockRefresh("shared-key", now + 600_000);

    await expect(coordinator.getToken("shared-key", refresh)).rejects.toThrow(
      "temporarily throttled",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("fails closed instead of refreshing Zoho when shared storage is unavailable", async () => {
    const store: MspOAuthTokenStore = {
      blockRefresh: vi.fn().mockRejectedValue(new Error("database unavailable")),
      getRefreshBlockedUntil: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
      getToken: vi.fn().mockRejectedValue(new Error("database unavailable")),
      invalidateToken: vi.fn().mockRejectedValue(new Error("database unavailable")),
      releaseRefreshLease: vi.fn().mockRejectedValue(new Error("database unavailable")),
      saveToken: vi.fn().mockRejectedValue(new Error("database unavailable")),
      tryAcquireRefreshLease: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "local-access-token",
      expiresInSeconds: 3600,
    });
    const coordinator = new MspOAuthAccessTokenCoordinator({ store });

    await expect(coordinator.getToken("shared-key", refresh)).rejects.toThrow(
      "shared token coordination is unavailable",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shares Zoho Access Denied cooldown across isolated server instances", async () => {
    const store = new MemoryTokenStore();
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("MSP Central OAuth refresh failed (Access Denied).");
    });
    const firstInstance = new MspOAuthAccessTokenCoordinator({
      store,
      waitIntervalMs: 1,
      waitTimeoutMs: 100,
    });
    const secondInstance = new MspOAuthAccessTokenCoordinator({
      store,
      waitIntervalMs: 1,
      waitTimeoutMs: 100,
    });

    const results = await Promise.allSettled([
      firstInstance.getToken("shared-key", refresh),
      secondInstance.getToken("shared-key", refresh),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("serves a still-valid shared token during the refresh cooldown", async () => {
    const now = Date.now();
    const store = new MemoryTokenStore();
    await store.saveToken("shared-key", {
      accessToken: "still-valid-shared-token",
      expiresAt: now + 30_000,
    });
    await store.blockRefresh("shared-key", now + 600_000);
    const refresh = vi.fn();
    const coordinator = new MspOAuthAccessTokenCoordinator({
      now: () => now,
      store,
    });

    await expect(coordinator.getToken("shared-key", refresh)).resolves.toBe(
      "still-valid-shared-token",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses a stable digest rather than credentials as the database key", () => {
    const cacheKey = buildMspOAuthCacheKey({
      accountsUrl: "https://accounts.zoho.com.au",
      clientId: "client-id",
      refreshToken: "secret-refresh-token",
    });

    expect(cacheKey).toBe(
      createHash("sha256")
        .update(
          [
            "https://accounts.zoho.com.au",
            "client-id",
            "secret-refresh-token",
          ].join("\n"),
        )
        .digest("hex"),
    );
    expect(cacheKey).not.toContain("client-id");
    expect(cacheKey).not.toContain("secret-refresh-token");
  });
});
