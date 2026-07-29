import { describe, expect, it, vi } from "vitest";

import {
  createPresenceOverrideRepository,
  type PresenceOverrideRow,
} from "./repository";

describe("presence override repository", () => {
  it("starts a technician app lunch override for exactly 30 minutes", async () => {
    const now = new Date("2026-07-30T02:15:00.000Z");
    const inserted: PresenceOverrideRow = {
      clearedAt: null,
      createdAt: now.toISOString(),
      createdByEmail: "tech@egit.com.au",
      endsAt: "2026-07-30T02:45:00.000Z",
      id: "presence-lunch",
      reason: null,
      source: "technician_app",
      startsAt: now.toISOString(),
      status: "lunch",
      technicianEmail: "tech@egit.com.au",
    };
    const store = {
      clearActive: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockResolvedValue(inserted),
      listActive: vi.fn(),
    };

    const override = await createPresenceOverrideRepository(store).startLunch({
      createdByEmail: " Tech@EGIT.com.au ",
      now,
      source: "technician_app",
      technicianEmail: " Tech@EGIT.com.au ",
    });

    expect(store.clearActive).toHaveBeenCalledWith({
      clearedAt: now.toISOString(),
      technicianEmail: "tech@egit.com.au",
    });
    expect(store.insert).toHaveBeenCalledWith({
      createdByEmail: "tech@egit.com.au",
      endsAt: "2026-07-30T02:45:00.000Z",
      reason: null,
      source: "technician_app",
      startsAt: now.toISOString(),
      status: "lunch",
      technicianEmail: "tech@egit.com.au",
    });
    expect(override).toMatchObject({
      endsAt: "2026-07-30T02:45:00.000Z",
      source: "technician_app",
      startsAt: now.toISOString(),
      status: "lunch",
      technicianEmail: "tech@egit.com.au",
    });
  });
});
