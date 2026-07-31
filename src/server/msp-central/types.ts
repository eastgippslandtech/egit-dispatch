import type { DispatchRequest, Technician } from "@/server/dispatch/types";

export type MspCentralRawTechnician = {
  email?: string | null;
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

export type MspCentralRequestNoteListResponse = {
  request_notes?: MspCentralRawRequestNote[];
};

export type MspCentralRequestUpdate = {
  author: string;
  body: string;
  createdAt?: string;
  id: string;
};

export type MspCentralRequestContext = {
  customerResponses: MspCentralRequestUpdate[];
  internalNotes: MspCentralRequestUpdate[];
  notesWarning?: string;
  request: DispatchRequest;
};

export type MspCentralRequestListResponse = {
  list_info?: {
    has_more_rows?: boolean | null;
    row_count?: number | null;
    start_index?: number | null;
    total_count?: number | null;
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
  addRequestWorklog?(input: {
    description: string;
    durationMinutes: number;
    endedAt: string;
    requestId: string;
    startedAt: string;
  }): Promise<void>;
  assignRequest(input: {
    requestId: string;
    technicianName: string;
  }): Promise<void>;
  getRequest(requestId: string): Promise<DispatchRequest | undefined>;
  getRequestContext(requestId: string): Promise<MspCentralRequestContext>;
  getTechnician(technicianId: string): Promise<Technician | undefined>;
  listCustomers(): Promise<Array<{ id: string; name: string }>>;
  listRequests(params?: MspCentralListRequestsParams): Promise<DispatchRequest[]>;
  listSites(): Promise<Array<{ id: string; name: string }>>;
  listTechnicians(): Promise<Technician[]>;
  mergeRequests(input: {
    childRequestId: string;
    parentRequestId: string;
  }): Promise<void>;
  refreshAccessToken(): Promise<string>;
  updateRequestSchedule(input: {
    requestId: string;
    scheduledEnd: string;
    scheduledStart: string;
    technicianName?: string;
  }): Promise<void>;
  updateRequestStatus?(input: {
    requestId: string;
    status: string;
  }): Promise<void>;
};
