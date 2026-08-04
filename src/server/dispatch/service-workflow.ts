import type { BookingType, DispatchRequest, Priority, RequestStatus } from "./types";
import type { WorklogDisposition } from "@/server/worklogs/disposition";

export const AUTO_CLASSIFICATION_CONFIDENCE = 0.9;

export type TemplateClassificationSource = "deterministic" | "manual" | "zia";
export type TrackItemType =
  | "approval"
  | "asset"
  | "checkbox"
  | "choice"
  | "date_time"
  | "evidence"
  | "text";
export type TrackItemStatus = "completed" | "not_applicable" | "pending";

export type TrackTemplateItem = {
  id: string;
  label: string;
  options?: string[];
  required: boolean;
  type: TrackItemType;
};

export type TrackTemplate = {
  id: string;
  items: TrackTemplateItem[];
  name: string;
  version: number;
};

export type ServiceTicketTemplate = {
  defaultBookingType: BookingType;
  defaultPriority: Priority;
  defaultStatus: RequestStatus;
  description: string;
  expectedDurationMinutes: number;
  id: string;
  name: string;
  requiresSolution: boolean;
  track?: TrackTemplate;
  version: number;
};

export type TemplateClassification = {
  confidence: number;
  reason: string;
  source: TemplateClassificationSource;
  templateId: string;
};

export type RequestTrackItem = TrackTemplateItem & {
  completedAt?: string;
  completedByEmail?: string;
  notApplicableReason?: string;
  status: TrackItemStatus;
  value?: string;
};

export type RequestTrack = {
  id: string;
  items: RequestTrackItem[];
  name: string;
  version: number;
};

export type RequestWorkflow = {
  appliedAt: string;
  appliedByEmail: string;
  classification: TemplateClassification;
  requestId: string;
  requiresSolution: boolean;
  templateId: string;
  templateName: string;
  templateVersion: number;
  track?: RequestTrack;
  updatedAt: string;
};

export type ClosureGuardrailResult = {
  blockers: Array<{ code: string; message: string }>;
  canClose: boolean;
};

export const serviceTicketTemplates: ServiceTicketTemplate[] = [
  template({
    description: "A concise support workflow for incidents and service requests.",
    id: "general-support",
    name: "General support",
    trackItems: [
      item("confirm-outcome", "Confirm the requested outcome", "text"),
      item("complete-work", "Complete and test the technical work", "checkbox"),
      item("customer-check", "Confirm the result with the requester", "checkbox"),
    ],
  }),
  template({
    bookingType: "Remote",
    description: "Create a user, apply services, secure access, and complete handover.",
    duration: 60,
    id: "user-onboarding",
    name: "User onboarding",
    trackItems: [
      item("start-details", "Confirm start date, manager, and role", "text"),
      item("account", "Create the user account and mailbox", "checkbox"),
      item("services", "Apply the customer services and licences", "checkbox"),
      item("mfa", "Enrol and verify MFA", "checkbox"),
      item("device", "Prepare or allocate the device", "asset"),
      item("handover", "Complete user or manager handover", "checkbox"),
    ],
  }),
  template({
    description: "Disable access, preserve data, recover assets, and confirm completion.",
    duration: 45,
    id: "user-offboarding",
    name: "User offboarding",
    trackItems: [
      item("finish-details", "Confirm finish time, manager, and access instructions", "text"),
      item("disable-access", "Disable sign-in and active sessions", "checkbox"),
      item("mail-data", "Apply mailbox and data retention instructions", "checkbox"),
      item("services", "Remove or reassign services and licences", "checkbox"),
      item("assets", "Record returned or outstanding assets", "asset"),
      item("manager-confirmation", "Confirm completion with the manager", "checkbox"),
    ],
  }),
  template({
    bookingType: "Onsite",
    description: "Capture requirements, prepare, deploy, secure, and hand over a new or replacement device.",
    duration: 90,
    id: "device-deployment",
    name: "New device setup",
    trackItems: [
      item("eta", "ETA or required-by date and time", "date_time"),
      item("user", "Assigned user, team, and role", "text"),
      item("setup-type", "Setup type", "choice", [
        "New user device",
        "Existing user replacement",
        "Additional device",
        "Shared device",
      ]),
      item("asset", "Select or record the deployed asset", "asset"),
      item("software", "Required software and configuration", "text"),
      item("licensing", "Required licences and access", "text"),
      item("migration", "Data migration source and requirements", "text"),
      item("accessories", "Required peripherals and accessories", "text"),
      item("build", "Apply the approved build and updates", "checkbox"),
      item("security", "Apply security and management policies", "checkbox"),
      item("applications", "Install required customer applications", "checkbox"),
      item("validation", "Test sign-in, connectivity, and peripherals", "checkbox"),
      item("asset-register", "Update the asset register and device ownership", "checkbox"),
      item("handover", "Complete user handover", "checkbox"),
    ],
    version: 2,
  }),
  template({
    bookingType: "Onsite",
    description: "Plan and complete a site installation with evidence and sign-off.",
    duration: 120,
    id: "site-installation",
    name: "Site installation",
    trackItems: [
      item("scope", "Confirm scope, access, and site contact", "text"),
      item("precheck", "Complete pre-installation checks", "checkbox"),
      item("installation", "Complete the installation", "checkbox"),
      item("evidence", "Attach installation evidence or photos", "evidence"),
      item("testing", "Test and record the result", "checkbox"),
      item("approval", "Obtain customer or project approval", "approval"),
    ],
  }),
  template({
    bookingType: "Remote",
    defaultPriority: "High",
    description: "Contain, remediate, validate, and document a security issue.",
    duration: 90,
    id: "security-remediation",
    name: "Security remediation",
    trackItems: [
      item("scope", "Record the affected users, devices, and services", "text"),
      item("contain", "Contain the threat or exposure", "checkbox"),
      item("remediate", "Complete remediation", "checkbox"),
      item("validate", "Validate security controls and service health", "checkbox"),
      item("evidence", "Attach supporting evidence", "evidence"),
      item("approval", "Obtain internal closure approval", "approval"),
    ],
  }),
  template({
    bookingType: "Remote",
    description: "Configure a new customer and record the operational handover.",
    duration: 180,
    id: "new-customer-setup",
    name: "New customer setup",
    trackItems: [
      item("contacts", "Confirm customer contacts and escalation paths", "text"),
      item("services", "Confirm contracted services", "choice", ["Configured", "Pending confirmation"]),
      item("documentation", "Record customer and site documentation", "checkbox"),
      item("monitoring", "Configure applicable monitoring and management", "checkbox"),
      item("support", "Validate support channels and notifications", "checkbox"),
      item("handover", "Complete internal service handover", "approval"),
    ],
  }),
];

const deterministicRules: Array<{
  confidence: number;
  keywords: string[];
  templateId: string;
}> = [
  { confidence: 0.96, keywords: ["new user", "user onboarding", "staff onboarding"], templateId: "user-onboarding" },
  { confidence: 0.96, keywords: ["user offboarding", "staff offboarding", "terminate user", "employee leaving"], templateId: "user-offboarding" },
  { confidence: 0.94, keywords: ["device deployment", "new device setup", "new laptop", "new workstation", "computer deployment"], templateId: "device-deployment" },
  { confidence: 0.94, keywords: ["site installation", "onsite installation", "site install"], templateId: "site-installation" },
  { confidence: 0.94, keywords: ["security remediation", "account compromise", "malware remediation"], templateId: "security-remediation" },
  { confidence: 0.96, keywords: ["new msp client", "new customer setup", "customer onboarding"], templateId: "new-customer-setup" },
];

export function classifyTicketTemplate(
  request: Pick<DispatchRequest, "category" | "item" | "notes" | "subcategory" | "subject">,
  options: {
    ziaSuggestion?: { confidence: number; templateId: string };
  } = {},
): TemplateClassification | null {
  const searchable = [
    request.category,
    request.subcategory,
    request.item,
    request.subject,
    request.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const deterministic = deterministicRules.find((rule) =>
    rule.keywords.some((keyword) => searchable.includes(keyword)),
  );
  if (deterministic) {
    return {
      confidence: deterministic.confidence,
      reason: "Matched an approved deterministic service rule.",
      source: "deterministic",
      templateId: deterministic.templateId,
    };
  }

  const zia = options.ziaSuggestion;
  if (
    zia &&
    zia.confidence >= AUTO_CLASSIFICATION_CONFIDENCE &&
    serviceTicketTemplates.some((candidate) => candidate.id === zia.templateId)
  ) {
    return {
      confidence: zia.confidence,
      reason: "Zia classification met the approved confidence threshold.",
      source: "zia",
      templateId: zia.templateId,
    };
  }
  return null;
}

export function applyTicketTemplate({
  actorEmail,
  classification,
  now = new Date().toISOString(),
  requestId,
  template,
}: {
  actorEmail: string;
  classification: TemplateClassification;
  now?: string;
  requestId: string;
  template: ServiceTicketTemplate;
}): RequestWorkflow {
  if (classification.templateId !== template.id) {
    throw new Error("The classification does not match the selected template.");
  }
  return {
    appliedAt: now,
    appliedByEmail: actorEmail,
    classification,
    requestId,
    requiresSolution: template.requiresSolution,
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version,
    track: template.track
      ? {
          id: template.track.id,
          items: template.track.items.map((trackItem) => ({
            ...trackItem,
            status: "pending" as const,
          })),
          name: template.track.name,
          version: template.track.version,
        }
      : undefined,
    updatedAt: now,
  };
}

export function updateTrackItem(
  workflow: RequestWorkflow,
  itemId: string,
  update: {
    actorEmail: string;
    notApplicableReason?: string;
    now?: string;
    status: TrackItemStatus;
    value?: string;
  },
): RequestWorkflow {
  if (!workflow.track) throw new Error("This request does not have a Track.");
  const existing = workflow.track.items.find((item) => item.id === itemId);
  if (!existing) throw new Error("The Track item could not be found.");
  const reason = update.notApplicableReason?.trim();
  if (update.status === "not_applicable" && !reason) {
    throw new Error("A reason is required when a Track item is not applicable.");
  }
  const value = update.value?.trim();
  if (
    update.status === "completed" &&
    existing.required &&
    existing.type !== "checkbox" &&
    existing.type !== "approval" &&
    !value
  ) {
    throw new Error("This Track item needs its required detail before completion.");
  }
  const now = update.now ?? new Date().toISOString();
  return {
    ...workflow,
    track: {
      ...workflow.track,
      items: workflow.track.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              completedAt: update.status === "pending" ? undefined : now,
              completedByEmail:
                update.status === "pending" ? undefined : update.actorEmail,
              notApplicableReason:
                update.status === "not_applicable" ? reason : undefined,
              status: update.status,
              value: value || undefined,
            }
          : item,
      ),
    },
    updatedAt: now,
  };
}

export function evaluateClosureGuardrails({
  disposition,
  solution,
  track,
  workflow,
  worklogDescription,
  worklogMinutes,
}: {
  disposition?: WorklogDisposition;
  solution?: string;
  track?: RequestTrack;
  workflow?: RequestWorkflow | null;
  worklogDescription: string;
  worklogMinutes: number;
}): ClosureGuardrailResult {
  if (disposition !== "complete") return { blockers: [], canClose: true };
  const blockers: ClosureGuardrailResult["blockers"] = [];
  if (!worklogDescription.trim() || !Number.isFinite(worklogMinutes) || worklogMinutes <= 0) {
    blockers.push({ code: "worklog_required", message: "Add a Work Log and positive time before closing." });
  }
  const activeTrack = track ?? workflow?.track;
  const unresolved = activeTrack?.items.filter(
    (item) => item.required && item.status === "pending",
  ) ?? [];
  if (unresolved.length > 0) {
    blockers.push({
      code: "track_incomplete",
      message: `${unresolved.length} mandatory Track ${unresolved.length === 1 ? "item is" : "items are"} unresolved.`,
    });
  }
  const invalidNotApplicable = activeTrack?.items.filter(
    (item) =>
      item.required &&
      item.status === "not_applicable" &&
      !item.notApplicableReason?.trim(),
  ) ?? [];
  if (invalidNotApplicable.length > 0) {
    blockers.push({
      code: "not_applicable_reason_required",
      message: "Every not-applicable Track item needs a reason.",
    });
  }
  if (workflow?.requiresSolution && !solution?.trim()) {
    blockers.push({
      code: "solution_required",
      message: "Use the customer-facing Work Log notes as the completion solution.",
    });
  }
  return { blockers, canClose: blockers.length === 0 };
}

function template({
  bookingType = "Remote",
  defaultPriority = "Medium",
  description,
  duration = 60,
  id,
  name,
  trackItems,
  version = 1,
}: {
  bookingType?: BookingType;
  defaultPriority?: Priority;
  description: string;
  duration?: number;
  id: string;
  name: string;
  trackItems: TrackTemplateItem[];
  version?: number;
}): ServiceTicketTemplate {
  return {
    defaultBookingType: bookingType,
    defaultPriority,
    defaultStatus: "Open",
    description,
    expectedDurationMinutes: duration,
    id,
    name,
    requiresSolution: true,
    track: {
      id: `${id}-track`,
      items: trackItems,
      name: `${name} Track`,
      version,
    },
    version,
  };
}

function item(
  id: string,
  label: string,
  type: TrackItemType,
  options?: string[],
): TrackTemplateItem {
  return { id, label, options, required: true, type };
}
