import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEmptyCommandCentreData } from "@/server/dispatch/mock-data";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";
import { PresenceControls } from "./presence-controls";

const technician = staffProfileToTechnician(getInitialStaffProfiles()[2]);
const snapshot = {
  dashboard: {
    ...getEmptyCommandCentreData(),
    technicians: [technician],
  },
  peopleStatus: "not_configured" as const,
  presences: [
    {
      conflicts: [],
      context: "Bairnsdale",
      label: "In office",
      source: "schedule" as const,
      status: "in_office" as const,
      technicianId: technician.id,
    },
  ],
  sourceWarnings: [],
  updatedAt: "2026-07-26T02:00:00.000Z",
};

describe("Dispatch presence controls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(snapshot), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );
  });

  it("opens Team status and starts Lunch for a selected technician", async () => {
    render(<PresenceControls technicians={[technician]} />);

    fireEvent.click(screen.getByRole("button", { name: "Team status" }));
    const panel = await screen.findByRole("dialog", { name: "Team status" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Start Lunch for Jervy" }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/internal/presence",
        expect.objectContaining({
          body: JSON.stringify({
            action: "start_lunch",
            technicianId: technician.id,
          }),
          method: "POST",
        }),
      ),
    );
  });

  it("sets manual Leave with a reason and required end time", async () => {
    render(<PresenceControls technicians={[technician]} />);

    fireEvent.click(screen.getByRole("button", { name: "Team status" }));
    const panel = await screen.findByRole("dialog", { name: "Team status" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Set Leave for Jervy" }),
    );
    fireEvent.change(within(panel).getByLabelText("Leave type"), {
      target: { value: "Sick" },
    });
    fireEvent.change(within(panel).getByLabelText("Leave until"), {
      target: { value: "2026-07-27T17:30" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm Leave" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/internal/presence",
        expect.objectContaining({
          body: JSON.stringify({
            action: "set_leave",
            endsAt: "2026-07-27T17:30",
            reason: "Sick",
            technicianId: technician.id,
          }),
          method: "POST",
        }),
      ),
    );
  });

  it("shows the pending presence action and prevents another submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshot), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    render(<PresenceControls technicians={[technician]} />);

    fireEvent.click(screen.getByRole("button", { name: "Team status" }));
    const panel = await screen.findByRole("dialog", { name: "Team status" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Start Lunch for Jervy" }),
    );

    const button = within(panel).getByRole("button", { name: "Starting Lunch..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
