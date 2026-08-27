import { describe, expect, it, vi } from "vitest";

import { createApiClient, MobileApiError } from "./client";

describe("mobile API client", () => {
  it("sends queued timer starts to the nested timer API route", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { timer: {} } }));
    const api = createApiClient({
      accessToken: "access-token",
      baseUrl: "https://command.egit.com.au/api/mobile/v1",
      fetcher,
      requestId: () => "request-1",
    });

    await api.sendMutation({
      actionType: "timer-start",
      attemptCount: 0,
      createdAt: "2026-08-14T01:00:00.000Z",
      dependsOn: [],
      id: "timer-start-job-1",
      jobId: "job-1",
      lastError: null,
      payload: { jobId: "job-1" },
      state: "pending",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://command.egit.com.au/api/mobile/v1/jobs/job-1/timer/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refreshes the access token and retries once when a request is unauthorized", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ data: { jobs: [{ id: "job-jervy" }] } }),
      );
    const refreshAccessToken = vi.fn(async () => "fresh-access-token");
    const api = createApiClient({
      accessToken: "expired-access-token",
      baseUrl: "https://command.egit.com.au/api/mobile/v1",
      fetcher,
      refreshAccessToken,
      requestId: () => "request-1",
    });

    const response = await api.request<{ data: { jobs: { id: string }[] } }>(
      "/jobs?from=2026-08-10&to=2026-08-10",
    );

    expect(response.data.jobs.map((job) => job.id)).toEqual(["job-jervy"]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://command.egit.com.au/api/mobile/v1/jobs?from=2026-08-10&to=2026-08-10",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer expired-access-token",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://command.egit.com.au/api/mobile/v1/jobs?from=2026-08-10&to=2026-08-10",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-access-token",
        }),
      }),
    );
  });

  it("keeps the unauthorized response when the session cannot be refreshed", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    const api = createApiClient({
      accessToken: "expired-access-token",
      baseUrl: "https://command.egit.com.au/api/mobile/v1",
      fetcher,
      refreshAccessToken: vi.fn(async () => null),
      requestId: () => "request-1",
    });

    await expect(api.request("/jobs")).rejects.toBeInstanceOf(MobileApiError);
    await expect(api.request("/jobs")).rejects.toMatchObject({ status: 401 });
  });
});
