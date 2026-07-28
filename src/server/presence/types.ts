export type PresenceStatus =
  | "closed"
  | "leave"
  | "lunch"
  | "driving"
  | "on_site"
  | "personal"
  | "meeting"
  | "in_office";

export type PresenceOverrideStatus = "leave" | "lunch";
export type PresenceOverrideSource =
  | "dispatch"
  | "technician_app"
  | "system";

export type PresenceOverride = {
  clearedAt?: string;
  createdAt: string;
  createdByEmail: string;
  endsAt: string;
  id: string;
  reason?: string;
  source: PresenceOverrideSource;
  startsAt: string;
  status: PresenceOverrideStatus;
  technicianEmail: string;
};

export type PresenceLeave = {
  endsAt: string;
  label: string;
  source: "outlook" | "zoho_people";
  startsAt: string;
  technicianEmail: string;
};

export type TechnicianPresence = {
  conflicts: string[];
  context: string;
  endsAt?: string;
  label: string;
  remainingMinutes?: number;
  source:
    | "calendar"
    | "manual_override"
    | "outlook"
    | "schedule"
    | "zoho_people";
  startsAt?: string;
  status: PresenceStatus;
  technicianId: string;
};

export type WallboardSnapshot = {
  dashboard: import("@/server/dispatch/types").DispatchDashboardData;
  peopleStatus: "connected" | "not_configured" | "unavailable";
  presences: TechnicianPresence[];
  sourceWarnings: string[];
  updatedAt: string;
};
