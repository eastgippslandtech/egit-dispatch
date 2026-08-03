import type { DispatchRequest, Technician } from "@/server/dispatch/types";
import type { WorklogType } from "@/server/worklogs/disposition";

export type MspCentralRawTechnician = {
  email?: string | null;
  email_id?: string | null;
  id?: string | number | null;
  name?: string | null;
};

export type MspCentralTimestamp =
  | string
  | number
  | {
      display_value?: string | null;
      value?: string | number | null;
    };

export type MspCentralRawRequest = {
  account?: { name?: string | null } | null;
  assets?: Array<{ name?: string | null }> | null;
  billable?: boolean | null;
  category?: string | { name?: string | null } | null;
  created_time?: MspCentralTimestamp | null;
  customer?: string | { name?: string | null } | null;
  description?: string | null;
  due_by_time?: MspCentralTimestamp | null;
  id?: string | number | null;
  is_billable?: boolean | null;
  is_onsite?: boolean | null;
  item?: string | { name?: string | null } | null;
  onsite?: boolean | null;
  priority?: string | { name?: string | null } | null;
  request_number?: string | null;
  requester?: {
    email?: string | null;
    email_id?: string | null;
    name?: string | null;
  } | null;
  requester_email?: string | null;
  requester_name?: string | null;
  scheduled_end_time?: MspCentralTimestamp | null;
  scheduled_start_time?: MspCentralTimestamp | null;
  sentiment?:
    | string
    | { name?: string | null; value?: string | null }
    | null;
  sentiment_analysis?:
    | string
    | { name?: string | null; value?: string | null }
    | null;
  requester_sentiment?:
    | string
    | { name?: string | null; value?: string | null }
    | null;
  site?: {
    address?: string | null;
    area?: string | null;
    city?: string | null;
    name?: string | null;
  } | null;
  site_address?: string | null;
  site_area?: string | null;
  site_name?: string | null;
  site_town?: string | null;
  sla?: { status?: string | null } | null;
  sla_status?: string | null;
  status?: string | { name?: string | null } | null;
  subcategory?: string | { name?: string | null } | null;
  subject?: string | null;
  technician?: MspCentralRawTechnician | null;
  udf_fields?: Record<string, unknown> | null;
  updated_time?: MspCentralTimestamp | null;
  updated_by?: { email?: string | null; name?: string | null } | null;
  last_updated_by?: { email?: string | null; name?: string | null } | null;
};

export type MspCentralRawRequestNote = {
  created_by?: {
    email?: string | null;
    email_id?: string | null;
    is_technician?: boolean | null;
    name?: string | null;
  } | null;
  created_time?: MspCentralTimestamp | null;
  description?: string | null;
  id?: string | number | null;
  show_to_requester?: boolean | null;
};

export type MspCentralListInfo = {
  has_more_rows?: boolean | string | null;
  row_count?: number | string | null;
  start_index?: number | string | null;
  total_count?: number | string | null;
};

export type MspCentralRequestNoteListResponse = {
  list_info?: MspCentralListInfo | null;
  request_notes?: MspCentralRawRequestNote[];
};

export type MspCentralRawWorklog = {
  created_by?: {
    email_id?: string | null;
    id?: string | number | null;
    name?: string | null;
  } | null;
  description?: string | null;
  end_time?: MspCentralTimestamp | null;
  id?: string | number | null;
  is_billable?: boolean | null;
  owner?: {
    email_id?: string | null;
    id?: string | number | null;
    name?: string | null;
  } | null;
  recorded_time?: MspCentralTimestamp | null;
  start_time?: MspCentralTimestamp | null;
  time_spent?: {
    hours?: string | number | null;
    minutes?: string | number | null;
    value?: string | number | null;
  } | null;
};

export type MspCentralRequestWorklogListResponse = {
  list_info?: MspCentralListInfo | null;
  worklogs?: MspCentralRawWorklog[];
};

export type MspCentralRequestUpdate = {
  author: string;
  body: string;
  createdAt?: string;
  durationMinutes?: number;
  id: string;
  isBillable?: boolean;
};

export type MspCentralRequestContext = {
  customerResponses: MspCentralRequestUpdate[];
  internalNotes: MspCentralRequestUpdate[];
  notesWarning?: string;
  request: DispatchRequest;
  worklogs: MspCentralRequestUpdate[];
  worklogsWarning?: string;
};

export type MspCentralRequestListResponse = {
  list_info?: {
    has_more_rows?: boolean | string | null;
    row_count?: number | string | null;
    start_index?: number | string | null;
    total_count?: number | string | null;
  } | null;
  requests?: MspCentralRawRequest[];
};

export type MspCentralRequestDetailResponse = {
  request?: MspCentralRawRequest;
};

export type MspCentralTechnicianListResponse = {
  technicians?: MspCentralRawTechnician[];
};

export type MspCentralListRequestsParams = {
  from?: string;
  status?: string;
  to?: string;
};

export type MspCentralClient = {
  addRequestNote?(input: {
    description: string;
    requestId: string;
    visibility: "customer" | "internal";
  }): Promise<void>;
  addRequestWorklog?(input: {
    description: string;
    durationMinutes: number;
    endedAt: string;
    ownerId: string;
    requestId: string;
    startedAt: string;
    worklogType: WorklogType;
  }): Promise<void>;
  assignRequest(input: {
    requestId: string;
    technicianEmail?: string;
    technicianName: string;
  }): Promise<void>;
  clearRequestSchedule(input: { requestId: string }): Promise<void>;
  createRequest?(input: {
    commandFingerprint?: string;
    customer?: string;
    description?: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    requesterEmail?: string;
    site?: string;
    subject: string;
  }): Promise<{ id: string; requestNumber: string }>;
  findRequestByCommandFingerprint?(
    commandFingerprint: string,
  ): Promise<{ id: string; requestNumber: string } | undefined>;
  getRequest(requestId: string): Promise<DispatchRequest | undefined>;
  getRequestContext(requestId: string): Promise<MspCentralRequestContext>;
  getTechnician(technicianId: string): Promise<Technician | undefined>;
  listCustomers(): Promise<Array<{ id: string; name: string }>>;
  listRequestNotes?(
    requestId: string,
  ): Promise<MspCentralRawRequestNote[]>;
  listRequests(params?: MspCentralListRequestsParams): Promise<DispatchRequest[]>;
  listRequestWorklogs?(
    requestId: string,
  ): Promise<MspCentralRawWorklog[]>;
  listSites(): Promise<Array<{ id: string; name: string }>>;
  listTechnicians(): Promise<Technician[]>;
  mergeRequests(input: {
    childRequestId: string;
    parentRequestId: string;
  }): Promise<void>;
  refreshAccessToken(): Promise<string>;
  setRequestResolution?(input: {
    content: string;
    requestId: string;
  }): Promise<void>;
  updateRequestSchedule(input: {
    requestId: string;
    scheduledEnd: string;
    scheduledStart: string;
    technicianEmail?: string;
    technicianId?: string;
    technicianName?: string;
  }): Promise<void>;
  updateRequestStatus?(input: {
    requestId: string;
    status: string;
  }): Promise<void>;
};
