import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { FailedActions } from "./failed-actions";
import { IntegrationHealth } from "./integration-health";
import IntegrationsPage from "./page";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

const getAccess = vi.mocked(getCommandCentreAccess);

beforeEach(() => {
  getAccess.mockResolvedValue({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("IntegrationHealth", () => {
  it("renders every operational connector state with pending and review counts", () => {
    render(
      <IntegrationHealth
        connectors={[
          connector("msp_central", "healthy"),
          connector("outlook", "degraded"),
          connector("push", "unavailable"),
          connector("email", "authentication_required"),
          connector("zoho_crm", "stale"),
        ]}
        counts={{ pending: 4, reviewRequired: 2 }}
      />,
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Authentication required")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("4 pending")).toBeInTheDocument();
    expect(screen.getByText("2 review required")).toBeInTheDocument();
    expect(screen.getAllByText("Safe provider error")).toHaveLength(4);
  });

  it("labels unknown connector health as not checked", () => {
    render(
      <IntegrationHealth
        connectors={[connector("outlook", "unknown")]}
        counts={{ pending: 0, reviewRequired: 0 }}
      />,
    );

    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("renders an explicit unknown state when connector health is absent", () => {
    render(
      <IntegrationHealth
        connectors={undefined as never}
        counts={{ pending: 0, reviewRequired: 0 }}
      />,
    );

    expect(screen.getByText("Status unknown")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });
});

describe("FailedActions", () => {
  it("shows only valid controls and opens the affected request", () => {
    render(
      <FailedActions
        actions={[
          action("operation-queued", "queued"),
          action("operation-review", "review_required"),
          action("operation-retry", "retrying"),
        ]}
        busyAction={undefined}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Confirm absent and retry" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Open request" })[0]).toHaveAttribute(
      "href",
      "/dispatch?requestId=REQ-1001",
    );
  });

  it("confirms destructive cancellation", () => {
    const onCancel = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <FailedActions
        actions={[action("operation-review", "review_required")]}
        busyAction={undefined}
        onCancel={onCancel}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledWith("operation-review");
  });

  it("requires explicit confirmation before retrying an ambiguous absent write", () => {
    const onRetry = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <FailedActions
        actions={[action("operation-review", "review_required")]}
        busyAction={undefined}
        onCancel={vi.fn()}
        onRetry={onRetry}
      />,
    );

    const button = screen.getByRole("button", { name: "Confirm absent and retry" });
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledWith("operation-review", true);
  });

  it("shows which recovery action is pending", () => {
    render(
      <FailedActions
        actions={[action("operation-review", "review_required")]}
        busyAction={{
          action: "retry",
          confirmedAbsent: false,
          operationId: "operation-review",
        }}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Retrying..." }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Retrying..." })).toBeDisabled();
  });
});

describe("IntegrationsPage", () => {
  it("renders an operational screen and loads protected no-store data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        connectors: [connector("msp_central", "healthy")],
        counts: { pending: 1, reviewRequired: 1 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        actions: [action("operation-review", "review_required")],
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(await IntegrationsPage());

    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeInTheDocument();
    expect(await screen.findByText("MSP Central Helpdesk")).toBeInTheDocument();
    expect(screen.getByText("Failed actions")).toBeInTheDocument();
    expect(screen.getByText("Recent recovery activity")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/integrations/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("derives recovery counts from loaded actions when count reads fall back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        connectors: [connector("command_centre", "unavailable")],
        counts: { pending: 0, reviewRequired: 0 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        actions: [action("operation-review", "review_required")],
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(await IntegrationsPage());

    expect(await screen.findByText("1 review required")).toBeInTheDocument();
  });

  it("surfaces authorization failure without stale updates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized." }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized." }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(await IntegrationsPage());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session no longer has access to integration recovery.",
    );
  });

  it("denies approved users without dispatch or admin access", async () => {
    getAccess.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "approved-but-not-dispatch@egit.com.au",
      name: "Read Only",
      status: "approved",
    });

    render(await IntegrationsPage());

    expect(screen.getByRole("heading", { name: "Access not approved" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("cleans up its refresh timer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse(
          url.endsWith("health")
            ? { connectors: [], counts: { pending: 0, reviewRequired: 0 } }
            : { actions: [] },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(await IntegrationsPage());
    await act(async () => Promise.resolve());
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(31_000));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores an older refresh that resolves after a newer refresh", async () => {
    vi.useFakeTimers();
    const firstHealth = deferredResponse();
    const firstActions = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstHealth.promise)
      .mockReturnValueOnce(firstActions.promise)
      .mockResolvedValueOnce(jsonResponse({
        connectors: [connector("outlook", "healthy")],
        counts: { pending: 2, reviewRequired: 0 },
      }))
      .mockResolvedValueOnce(jsonResponse({ actions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(await IntegrationsPage());
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByText("2 pending")).toBeInTheDocument();

    await act(async () => {
      firstHealth.resolve(jsonResponse({
        connectors: [connector("outlook", "unavailable")],
        counts: { pending: 9, reviewRequired: 0 },
      }));
      firstActions.resolve(jsonResponse({ actions: [] }));
      await Promise.resolve();
    });

    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.queryByText("9 pending")).not.toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});

function connector(connectorName: string, status: string) {
  return {
    connector: connectorName,
    consecutiveFailures: status === "healthy" ? 0 : 1,
    lastCheckedAt: "2026-08-04T01:10:00.000Z",
    lastError: status === "healthy" ? undefined : "Safe provider error",
    lastReadAt: "2026-08-04T01:00:00.000Z",
    lastWriteAt: "2026-08-04T01:05:00.000Z",
    status,
  } as never;
}

function action(id: string, state: "queued" | "retrying" | "review_required") {
  return {
    actionType: "helpdesk.worklog",
    actorEmail: "simeon@egit.com.au",
    attemptCount: 2,
    createdAt: "2026-08-04T01:00:00.000Z",
    id,
    lastError: "Provider request needs attention",
    requestId: "REQ-1001",
    state,
    updatedAt: "2026-08-04T01:05:00.000Z",
  } as const;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
