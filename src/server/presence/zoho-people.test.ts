import { describe, expect, it, vi } from "vitest";

import type { Technician } from "@/server/dispatch/types";
import {
  createZohoPeopleClient,
  readZohoPeopleConfig,
} from "./zoho-people";

const technician: Technician = {
  active: true,
  displayName: "Jervy",
  id: "tech-jervy",
  mappingStatus: "mapped",
  outlookEmail: "jervy@egit.com.au",
  storeLocation: "Bairnsdale",
  zohoEmail: "jervy@egit.com.au",
  zohoPeopleEmployeeId: "4338264",
};

describe("Zoho People leave client", () => {
  it("stays disabled until separate People service credentials are complete", () => {
    expect(readZohoPeopleConfig({})).toBeNull();
    expect(
      readZohoPeopleConfig({
        ZOHO_PEOPLE_CLIENT_ID: "client",
        ZOHO_PEOPLE_CLIENT_SECRET: "secret",
      }),
    ).toBeNull();
  });

  it("refreshes a service token and maps approved partial-day leave by employee id", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "people-access-token" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                approval_status: "Approved",
                days: {
                  "26-Jul-2026": {
                    end_time: "13:00",
                    leave_count: "0.5",
                    start_time: "09:00",
                  },
                },
                employee: {
                  name: "Jervy",
                  zoho_id: 4338264,
                },
                from_date: "26-Jul-2026",
                leave_type: { name: "Sick" },
                to_date: "26-Jul-2026",
              },
            ],
            status: "success",
          }),
        ),
      );
    const client = createZohoPeopleClient({
      config: {
        accountsUrl: "https://accounts.zoho.com.au",
        apiBaseUrl: "https://people.zoho.com.au",
        clientId: "people-client",
        clientSecret: "people-secret",
        refreshToken: "people-refresh",
      },
      fetchImpl,
    });

    const leaves = await client.listApprovedLeave({
      fromDate: "2026-07-26",
      technicians: [technician],
      toDate: "2026-07-26",
    });

    expect(leaves).toEqual([
      {
        endsAt: "2026-07-26T13:00:00+10:00",
        label: "Sick",
        source: "zoho_people",
        startsAt: "2026-07-26T09:00:00+10:00",
        technicianEmail: "jervy@egit.com.au",
      },
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://accounts.zoho.com.au/oauth/v2/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "https://people.zoho.com.au/people/api/v3/leave-tracker/leaves?",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Zoho-oauthtoken people-access-token",
        }),
        method: "GET",
      }),
    );
  });

  it("ignores unapproved and unmapped leave records", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                approval_status: "Pending",
                days: {
                  "26-Jul-2026": {
                    end_time: "17:30",
                    start_time: "09:00",
                  },
                },
                employee: { zoho_id: 4338264 },
                leave_type: { name: "Annual leave" },
              },
              {
                approval_status: "Approved",
                days: {
                  "26-Jul-2026": {
                    end_time: "17:30",
                    start_time: "09:00",
                  },
                },
                employee: { zoho_id: 999999 },
                leave_type: { name: "Annual leave" },
              },
            ],
          }),
        ),
      );
    const client = createZohoPeopleClient({
      config: {
        accountsUrl: "https://accounts.zoho.com.au",
        apiBaseUrl: "https://people.zoho.com.au",
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
      },
      fetchImpl,
    });

    await expect(
      client.listApprovedLeave({
        fromDate: "2026-07-26",
        technicians: [technician],
        toDate: "2026-07-26",
      }),
    ).resolves.toEqual([]);
  });
});
