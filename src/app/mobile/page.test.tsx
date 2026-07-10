import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import MobilePage from "./page";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);

const originalGeolocation = navigator.geolocation;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    email: "riley@egit.com.au",
    name: "Riley",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: originalGeolocation,
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function mockGeolocation({
  denied = false,
}: {
  denied?: boolean;
} = {}) {
  const getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      error?: PositionErrorCallback | null,
    ) => {
      if (denied) {
        error?.({
          code: 1,
          message: "Permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
        return;
      }

      success({
        coords: {
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: -37.825,
          longitude: 147.63,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    },
  );
  const watchPosition = vi.fn();

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      clearWatch: vi.fn(),
      getCurrentPosition,
      watchPosition,
    },
  });

  return { getCurrentPosition, watchPosition };
}

test("/mobile opens to My Schedule for the signed-in technician", async () => {
  render(await MobilePage());

  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre Mobile" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Riley").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "My Schedule" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("Firewall firmware window")).toBeInTheDocument();
  expect(screen.queryByText("File server disk expansion")).not.toBeInTheDocument();
});

test("/mobile redirects unauthenticated users to Zoho sign-in", async () => {
  getCommandCentreAccessMock.mockResolvedValue({ status: "unauthenticated" });

  await expect(MobilePage()).rejects.toThrow(
    "NEXT_REDIRECT:/auth/sign-in?callbackUrl=/mobile",
  );
});

test("/mobile blocks Zoho users outside the Command Centre allowlist", async () => {
  getCommandCentreAccessMock.mockResolvedValue({
    status: "not-approved",
    email: "external@example.com",
    name: "External User",
  });

  render(await MobilePage());

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/external@example.com/)).toBeInTheDocument();
});

test("tapping a job opens detail and stopping a timer shows Worklog Summary", async () => {
  render(await MobilePage());

  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));
  expect(screen.getByRole("heading", { name: "Firewall firmware window" })).toBeInTheDocument();
  expect(
    screen.getByText("MSP Central API access is not configured yet."),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
  expect(screen.getByText(/Timer running/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
  expect(screen.getByRole("heading", { name: "Worklog Summary" })).toBeInTheDocument();
  expect(screen.getByText("Rounded time")).toBeInTheDocument();
  expect(
    screen.getByText("Time rounds up to the next 15 minutes."),
  ).toBeInTheDocument();
});

test("Outlook-only events remain read-only in job detail", async () => {
  render(await MobilePage());

  fireEvent.click(screen.getByRole("button", { name: /Outlook calendar block/ }));

  expect(screen.getByText("Outlook Read Only")).toBeInTheDocument();
  expect(
    screen.getByText(/This is a read-only Outlook event./),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Outlook writeback is not enabled yet./),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start timer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Complete job" })).toBeDisabled();
  expect(screen.getByLabelText("Work note")).toBeDisabled();
  expect(screen.getByLabelText("Change status")).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open Outlook Event" })).toBeInTheDocument();
  expect(screen.getByLabelText("Evidence type")).toBeDisabled();
  expect(screen.getByLabelText("Evidence file name")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add photo/attachment" })).toBeDisabled();
  expect(screen.getByLabelText("Customer name")).toBeDisabled();
  expect(screen.getByLabelText("Customer accepted work")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save sign-off" })).toBeDisabled();
  expect(screen.getByLabelText("Part name")).toBeDisabled();
  expect(screen.getByLabelText("Part quantity")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add part used" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: /Asset/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Device/i })).not.toBeInTheDocument();
});

test("job detail renders on a narrow mobile viewport", async () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));

  expect(screen.getByRole("heading", { name: "Firewall firmware window" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start timer" })).toBeInTheDocument();
  expect(screen.getByLabelText("Work note")).toBeInTheDocument();
});

test("does not show a future job detail when today has no jobs", async () => {
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    email: "simeon@egit.com.au",
    name: "Simeon",
  });

  render(await MobilePage());

  expect(screen.getByText("No jobs scheduled for today.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Network cabinet tidy" })).not.toBeInTheDocument();
});

test("quick note save failure keeps the typed draft visible", async () => {
  render(await MobilePage());

  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));
  fireEvent.change(screen.getByLabelText("Work note"), {
    target: { value: "Remember to update client" },
  });
  fireEvent.click(screen.getByLabelText("Simulate note save failure"));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  expect(
    screen.getByText("Note save failed. Draft preserved for retry."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Work note")).toHaveValue(
    "Remember to update client",
  );
});

test("job detail includes mock scaffolds for photos, sign-off, and parts used", async () => {
  render(await MobilePage());

  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));

  expect(screen.getByRole("heading", { name: "Attachments and photos" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Customer sign-off" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Parts used" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Evidence file name"), {
    target: { value: "firewall-after.jpg" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add photo/attachment" }));
  expect(
    screen.getByText("Evidence staged locally. Mock pending upload."),
  ).toBeInTheDocument();
  expect(screen.getByText("firewall-after.jpg")).toBeInTheDocument();
  expect(screen.getByText("Mock pending upload")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Customer name"), {
    target: { value: "Alex Client" },
  });
  fireEvent.change(screen.getByLabelText("Signature text"), {
    target: { value: "Alex Client" },
  });
  fireEvent.click(screen.getByLabelText("Customer accepted work"));
  fireEvent.click(screen.getByRole("button", { name: "Save sign-off" }));
  expect(
    screen.getByText("Customer sign-off saved locally. Mock pending sync."),
  ).toBeInTheDocument();
  expect(screen.getByText(/Signed by Alex Client/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Part name"), {
    target: { value: "Patch lead" },
  });
  fireEvent.change(screen.getByLabelText("Part quantity"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add part used" }));
  expect(
    screen.getByText("Part staged locally. Mock pending sync. No inventory writeback."),
  ).toBeInTheDocument();
  expect(screen.getByText("Patch lead x2")).toBeInTheDocument();
});

test("location is requested only when Calculate ETA is tapped", async () => {
  const geolocation = mockGeolocation();

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));

  expect(screen.getByText(
    "Location is only used on this device to calculate your ETA for this job.",
  )).toBeInTheDocument();
  expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(geolocation.watchPosition).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Calculate ETA" }));

  await screen.findByText(/ETA:/);
  expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(geolocation.watchPosition).not.toHaveBeenCalled();
});

test("denied location permission keeps job detail usable and shows Maps fallback", async () => {
  mockGeolocation({ denied: true });

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));
  fireEvent.click(screen.getByRole("button", { name: "Calculate ETA" }));

  expect(
    await screen.findByText("Location permission is off. Open in Maps instead."),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Firewall firmware window" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open in Maps" })).toBeInTheDocument();
});

test("ETA controls are hidden for jobs without a site address", async () => {
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    email: "simeon@egit.com.au",
    name: "Simeon",
  });

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));

  expect(screen.getByRole("heading", { name: "Network cabinet tidy" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Calculate ETA" })).not.toBeInTheDocument();
});

test("ETA calculation does not store exact GPS in job or worklog history", async () => {
  const geolocation = mockGeolocation();

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));
  fireEvent.click(screen.getByRole("button", { name: "Calculate ETA" }));

  await screen.findByText(/ETA:/);
  const persistedValues = [
    ...Object.values(window.localStorage),
    ...Object.values(window.sessionStorage),
    document.body.textContent ?? "",
  ].join(" ");

  expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(persistedValues).not.toContain("-37.825");
  expect(persistedValues).not.toContain("147.63");
});

test("no background tracking service is started for ETA", async () => {
  const geolocation = mockGeolocation();

  render(await MobilePage());
  fireEvent.click(screen.getByRole("button", { name: /Firewall firmware window/ }));
  fireEvent.click(screen.getByRole("button", { name: "Calculate ETA" }));

  await waitFor(() => expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1));
  expect(geolocation.watchPosition).not.toHaveBeenCalled();
});

test("mobile UI does not expose live tracking or dispatcher map features", async () => {
  render(await MobilePage());

  expect(screen.queryByText(/live tracking/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/dispatcher map/i)).not.toBeInTheDocument();
});
