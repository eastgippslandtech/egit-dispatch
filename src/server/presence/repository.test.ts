import { describe, expect, it } from "vitest";

import {
  createPresenceOverrideRepository,
  type PresenceOverrideRow,
  type PresenceOverrideStore,
} from "./repository";

function memoryStore(seed: PresenceOverrideRow[] = []) {
  const rows = [...seed];
  const store: PresenceOverrideStore = {
    async clearActive({ clearedAt, technicianEmail }) {
      for (const row of rows) {
        if (
          row.technicianEmail.toLowerCase() === technicianEmail.toLowerCase() &&
          !row.clearedAt
        ) {
          row.clearedAt = clearedAt;
        }
      }
    },
    async insert(row) {
      const stored: PresenceOverrideRow = {
        ...row,
        clearedAt: null,
        createdAt: row.startsAt,
        id: `override-${rows.length + 1}`,
      };
      rows.push(stored);
      return stored;
    },
    async listActive(now) {
      return rows.filter(
        (row) =>
          !row.clearedAt &&
          new Date(row.startsAt) <= now &&
          new Date(row.endsAt) > now,
      );
    },
  };

  return { rows, store };
}

describe("presence override repository", () => {
  it("starts Lunch immediately with an exact 30-minute expiry", async () => {
    const { store } = memoryStore();
    const repository = createPresenceOverrideRepository(store);

    const lunch = await repository.startLunch({
      createdByEmail: "jervy@egit.com.au",
      now: new Date("2026-07-26T02:00:00.000Z"),
      source: "technician_app",
      technicianEmail: "jervy@egit.com.au",
    });

    expect(lunch).toMatchObject({
      endsAt: "2026-07-26T02:30:00.000Z",
      startsAt: "2026-07-26T02:00:00.000Z",
      status: "lunch",
      technicianEmail: "jervy@egit.com.au",
    });
  });

  it("rejects Leave without a future end time", async () => {
    const { store } = memoryStore();
    const repository = createPresenceOverrideRepository(store);

    await expect(
      repository.setLeave({
        createdByEmail: "simeon@egit.com.au",
        endsAt: "2026-07-26T02:00:00.000Z",
        now: new Date("2026-07-26T02:00:00.000Z"),
        reason: "Annual leave",
        source: "dispatch",
        technicianEmail: "jervy@egit.com.au",
      }),
    ).rejects.toThrow("Leave must end after it starts.");
  });

  it("normalises identity and stores a safe Leave reason", async () => {
    const { store } = memoryStore();
    const repository = createPresenceOverrideRepository(store);

    const leave = await repository.setLeave({
      createdByEmail: "SIMEON@EGIT.COM.AU",
      endsAt: "2026-07-26T07:30:00.000Z",
      now: new Date("2026-07-26T02:00:00.000Z"),
      reason: "  Sick  ",
      source: "dispatch",
      technicianEmail: " JERVY@EGIT.COM.AU ",
    });

    expect(leave).toMatchObject({
      createdByEmail: "simeon@egit.com.au",
      reason: "Sick",
      status: "leave",
      technicianEmail: "jervy@egit.com.au",
    });
  });

  it("lists only active overrides and clears the technician's current state", async () => {
    const now = new Date("2026-07-26T02:15:00.000Z");
    const { rows, store } = memoryStore([
      {
        clearedAt: null,
        createdAt: "2026-07-26T02:00:00.000Z",
        createdByEmail: "jervy@egit.com.au",
        endsAt: "2026-07-26T02:30:00.000Z",
        id: "active",
        reason: null,
        source: "technician_app",
        startsAt: "2026-07-26T02:00:00.000Z",
        status: "lunch",
        technicianEmail: "jervy@egit.com.au",
      },
      {
        clearedAt: null,
        createdAt: "2026-07-26T01:00:00.000Z",
        createdByEmail: "jervy@egit.com.au",
        endsAt: "2026-07-26T01:30:00.000Z",
        id: "expired",
        reason: null,
        source: "technician_app",
        startsAt: "2026-07-26T01:00:00.000Z",
        status: "lunch",
        technicianEmail: "jervy@egit.com.au",
      },
    ]);
    const repository = createPresenceOverrideRepository(store);

    await expect(repository.listActive(now)).resolves.toEqual([
      expect.objectContaining({ id: "active" }),
    ]);
    await repository.clear({
      now,
      technicianEmail: "jervy@egit.com.au",
    });

    expect(rows.find((row) => row.id === "active")?.clearedAt).toBe(
      "2026-07-26T02:15:00.000Z",
    );
    await expect(repository.listActive(now)).resolves.toEqual([]);
  });
});
