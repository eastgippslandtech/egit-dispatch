import { describe, expect, it, vi } from "vitest";

import type { MobileSession } from "./session-store";
import {
  isMobileSessionExpiring,
  refreshMobileSession,
} from "./session-refresh";

const savedSession: MobileSession = {
  accessToken: "old-access",
  expiresAt: "2026-07-12T05:00:00.000Z",
  refreshToken: "refresh-token",
  staffEmail: "simeon@egit.com.au",
};

describe("mobile session refresh", () => {
  it("keeps a saved session when it is not near expiry", async () => {
    const fetcher = vi.fn();

    const session = await refreshMobileSession(savedSession, {
      fetcher,
      now: () => new Date("2026-07-12T04:45:00.000Z"),
    });

    expect(session).toEqual(savedSession);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("renews an expired saved session without another Zoho prompt", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            accessToken: "new-access",
            expiresAt: "2026-07-12T06:00:00.000Z",
            refreshToken: "new-refresh",
            status: "refreshed",
          },
        }),
        { status: 200 },
      ),
    );

    const session = await refreshMobileSession(savedSession, {
      fetcher,
      now: () => new Date("2026-07-12T05:00:00.000Z"),
    });

    expect(session).toEqual({
      accessToken: "new-access",
      expiresAt: "2026-07-12T06:00:00.000Z",
      refreshToken: "new-refresh",
      staffEmail: "simeon@egit.com.au",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://command.egit.com.au/api/mobile/v1/auth/refresh",
      expect.objectContaining({
        body: JSON.stringify({ refreshToken: "refresh-token" }),
        method: "POST",
      }),
    );
  });

  it("returns null when the refresh token is no longer valid", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));

    await expect(
      refreshMobileSession(savedSession, {
        fetcher,
        now: () => new Date("2026-07-12T05:00:00.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("keeps the saved session when the refresh service is temporarily unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(
      refreshMobileSession(savedSession, {
        fetcher,
        now: () => new Date("2026-07-12T05:00:00.000Z"),
      }),
    ).resolves.toEqual(savedSession);
  });

  it("keeps the saved session when the refresh request cannot reach the server", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });

    await expect(
      refreshMobileSession(savedSession, {
        fetcher,
        now: () => new Date("2026-07-12T05:00:00.000Z"),
      }),
    ).resolves.toEqual(savedSession);
  });

  it("treats sessions inside the safety window as expiring", () => {
    expect(
      isMobileSessionExpiring(savedSession, {
        now: () => new Date("2026-07-12T04:56:00.000Z"),
      }),
    ).toBe(true);
  });
});
