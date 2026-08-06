import { describe, expect, it, vi } from "vitest";

import { YeastarClient } from "./client";

describe("YeastarClient", () => {
  it("uses the required User-Agent and v2 CDR endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access",
            access_token_expire_time: 1800,
            errcode: 0,
            refresh_token: "refresh",
            refresh_token_expire_time: 86400,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { basic: { uid: "cdr-1" } }, errcode: 0 }), {
          status: 200,
        }),
      );
    const client = new YeastarClient({
      config: {
        baseUrl: "https://pbx.example.com",
        clientId: "client",
        clientSecret: "secret",
        userAgent: "Command-Centre-Test",
      },
      fetchImpl: fetchMock,
    });

    await client.getCdrDetail("cdr-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/openapi/v2.0/cdr/detail?"),
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "Command-Centre-Test" }),
      }),
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain("uid=cdr-1");
  });

  it("never calls the AI download endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          access_token_expire_time: 1800,
          errcode: 0,
          refresh_token: "refresh",
          refresh_token_expire_time: 86400,
        }),
        { status: 200 },
      ),
    );
    const client = new YeastarClient({
      config: {
        baseUrl: "https://pbx.example.com",
        clientId: "client",
        clientSecret: "secret",
        userAgent: "test",
      },
      fetchImpl: fetchMock,
    });

    expect("downloadRecording" in client).toBe(false);
    expect("downloadAi" in client).toBe(false);
  });
});
