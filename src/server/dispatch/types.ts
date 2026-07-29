export type Severity = "critical" | "warning" | "info" | "healthy";
export type SlaState = "overdue" | "due-soon" | "normal";
export type Priority = "Critical" | "High" | "Medium" | "Low";
export type BookingType = "Remote" | "Onsite" | "In house";
export type RequestStatus =
  | "Open"
  | "Ready for Scheduling"
  | "Scheduled"
  | "Resolved";
export type SyncStatus =
  | "linked"
  | "needs-review"
  | "sdp-only"
  | "outlook-only"
  | "failed";

export type Technician = {
  id: string;
  displayName: string;
  zohoEmail?: string;
  zohoPeopleEmployeeId?: string | null;
  sdpTechnicianName?: string;
  outlookEmail: string;
  outlookUserPrincipalName?: string;
  mspCentralEmail?: string;
  mspCentralTechnicianId?: string | null;
  mspCentralTechnicianName?: string | null;
  role?: "admin" | "technician";
  calendarEnabled?: boolean;
  storeLocation: string;
  baseOfficeId?: "bairnsdale" | "sale";
  baseOfficeName?: string;
  baseOfficeAddress?: string;
  active: boolean;
  mappingStatus: "mapped" | "missing-sdp" | "missing-outlook";
};

export type TravelMode =
  | "office_to_site_and_back"
  | "previous_job_to_site"
  | "current_area_to_site"
  | "manual_override";

export type TravelCalculatedFrom =
  | "technician_base_office"
  | "previous_job"
  | "current_area"
  | "manual_override";

export type DispatchRequest = {
  id: string;
  requestNumber: string;
  subject: string;
  sourceSystem?: "mock" | "msp-central-fixture" | "msp-central" | "command-centre-db";
  helpdeskUrl?: string;
  notes?: string;
  updatedAt?: string;
  updatedByEmail?: string;
  updateInfo?: {
    at: string;
    detail?: string;
    source: "command-centre" | "msp-central" | "technician-app" | "test-sync";
    summary: string;
  };
  category?: string;
  subcategory?: string;
  item?: string;
  assetNames?: string[];
  customer: string;
  site: string;
  siteName?: string;
  siteAddress?: string;
  siteTown?: string;
  siteArea?: string;
  onsite?: boolean;
  mockTravelMinutes?: number;
  requester: string;
  contact: string;
  priority: Priority;
  status: RequestStatus;
  bookingType?: BookingType;
  technicianId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  dueAt: string;
  ageHours: number;
  billable: boolean;
  readyToBook: boolean;
  slaState: SlaState;
  warnings: string[];
};

export type Appointment = {
  id: string;
  date?: string;
  requestId?: string;
  technicianId: string;
  title: string;
  customer: string;
  siteAddress?: string;
  siteTown?: string;
  siteArea?: string;
  officeOriginId?: "bairnsdale" | "sale";
  officeOriginName?: string;
  officeOriginAddress?: string;
  travelMode?: TravelMode;
  travelCalculatedFrom?: TravelCalculatedFrom;
  travelCalculationReason?: string;
  travelToSiteMinutes?: number;
  travelBackToOfficeMinutes?: number;
  travelEstimated?: boolean;
  travelWarning?: string;
  start: string;
  end: string;
  bookingType?: BookingType;
  status: "confirmed" | "tentative" | "busy" | "sdp-only";
  source: "outlook" | "linked" | "sdp";
  syncIssue?: "double-booked" | "missing-calendar" | "time-mismatch" | "past-open";
  outlookEventId?: string;
  outlookWebLink?: string;
  outlookOrganizer?: string;
  outlookAttendees?: string[];
  outlookCategories?: string[];
  outlookShowAs?: string;
  outlookSensitivity?: string;
  outlookLinkedRequestNumber?: string;
  outlookIssue?: "unlinked" | "private" | "all-day" | "closed-day";
  calendarOwnerEmail?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  readOnly?: boolean;
};

export type DispatchAppointment = Appointment;

export type DispatchLink = {
  id: string;
  sdpRequestId: string;
  sdpRequestNumber: string;
  outlookEventId?: string;
  outlookCalendarEmail?: string;
  technicianId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  lastSdpHash?: string;
  lastOutlookHash?: string;
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthItem = {
  key: string;
  label: string;
  count: number;
  severity: Severity;
  description: string;
};

export type DispatchDashboardData = {
  calendarDataSource?: "mock" | "outlook";
  calendarError?: string;
  calendarReadOnly?: boolean;
  calendarStatusLabel?: string;
  dispatchDataSource?: "mock" | "msp-central-fixture" | "msp-central" | "command-centre-db";
  selectedDateLabel: string;
  timezone: string;
  technicians: Technician[];
  requests: DispatchRequest[];
  appointments: Appointment[];
  healthItems: HealthItem[];
  selectedRequestId: string;
};

export type DispatchDesignMockData = DispatchDashboardData;
