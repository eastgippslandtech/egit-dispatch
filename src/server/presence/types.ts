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
