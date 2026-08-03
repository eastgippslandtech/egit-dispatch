import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  operationPollingIntervalMs,
  operationStateForRequest,
  GlobalIntegrationStatus,
  useTrackedIntegrationOperations,
} from "./operation-status";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("review required takes precedence over a pending operation for a request", () => {
  expect(
    operationStateForRequest(
      [
        tracked("operation-1", "queued"),
        tracked("operation-2", "review_required"),
      ],
      "REQ-1",
    ),
  ).toBe("review_required");
});

test("global integration state stays compact and links to recovery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ counts: { pending: 2, reviewRequired: 1 } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  render(<GlobalIntegrationStatus localOperations={[]} />);

  expect(await screen.findByRole("link", { name: "2 syncing, 1 review required" })).toHaveAttribute(
    "href",
    "/integrations",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("global integration state never claims connected when a connector is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connectors: [{ connector: "msp_central", status: "unavailable" }],
          counts: { pending: 0, reviewRequired: 0 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  render(<GlobalIntegrationStatus localOperations={[]} />);

  expect(
    await screen.findByRole("link", { name: "Integrations unavailable" }),
  ).toHaveAttribute("href", "/integrations");
  expect(
    screen.queryByRole("link", { name: "Integrations connected" }),
  ).not.toBeInTheDocument();
});

test("pending operations poll every three seconds and clear after syncing", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(operationResponse("syncing"))
    .mockResolvedValueOnce(operationResponse("synced"));
  vi.stubGlobal("fetch", fetchMock);

  function Harness() {
    const tracker = useTrackedIntegrationOperations();
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            tracker.track({
              appointmentId: "appointment-1",
              operationId: "operation-1",
              requestId: "REQ-1",
              state: "queued",
            })
          }
        >
          Track
        </button>
        <span>{tracker.stateForRequest("REQ-1") ?? "clear"}</span>
      </div>
    );
  }

  const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Track" }));
  expect(screen.getByText("queued")).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTimeAsync(operationPollingIntervalMs));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/internal/integrations/actions/operation-1",
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(screen.getByText("syncing")).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTimeAsync(operationPollingIntervalMs));
  expect(screen.getByText("clear")).toBeInTheDocument();

  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(operationPollingIntervalMs));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("review-required operations persist until recovery", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(operationResponse("review_required")));

  function Harness() {
    const tracker = useTrackedIntegrationOperations();
    return (
      <>
        <button type="button" onClick={() => tracker.track(tracked("operation-1", "queued"))}>Track</button>
        <span>{tracker.stateForRequest("REQ-1") ?? "clear"}</span>
      </>
    );
  }

  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Track" }));
  await act(async () => vi.advanceTimersByTimeAsync(operationPollingIntervalMs));

  expect(screen.getByText("review_required")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(operationPollingIntervalMs * 2));
  expect(screen.getByText("review_required")).toBeInTheDocument();
});

function tracked(
  operationId: string,
  state: "queued" | "review_required",
) {
  return { operationId, requestId: "REQ-1", state } as const;
}

function operationResponse(state: string) {
  return new Response(
    JSON.stringify({
      operation: {
        actionType: "schedule.booking",
        attemptCount: 1,
        createdAt: "2026-08-04T01:00:00.000Z",
        id: "operation-1",
        requestId: "REQ-1",
        state,
        updatedAt: "2026-08-04T01:01:00.000Z",
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
