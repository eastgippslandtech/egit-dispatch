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

export type MspCentralRawAttachment = {
  attachment_url?: string | null;
  content_type?: string | null;
  file_name?: string | null;
  filename?: string | null;
  href?: string | null;
  id?: string | number | null;
  name?: string | null;
  size?: string | number | null;
  url?: string | null;
};

export type MspCentralRawRequest = {
  account?: {
    address?: string | null;
    billing_address?: string | null;
    billing_city?: string | null;
    billing_code?: string | null;
    billing_country?: string | null;
    billing_state?: string | null;
    billing_street?: string | null;
    city?: string | null;
    country?: string | null;
    id?: string | number | null;
    name?: string | null;
    postal_code?: string | null;
    shipping_address?: string | null;
    shipping_city?: string | null;
    shipping_code?: string | null;
    shipping_country?: string | null;
    shipping_state?: string | null;
    shipping_street?: string | null;
    state?: string | null;
    street?: string | null;
    zip?: string | null;
  } | null;
  assets?: Array<{ name?: string | null }> | null;
  attachments?: MspCentralRawAttachment[] | null;
  billable?: boolean | null;
  category?: string | { name?: string | null } | null;
  created_time?: MspCentralTimestamp | null;
  customer?: string | { name?: string | null } | null;
  description?: string | null;
  due_by_time?: MspCentralTimestamp | null;
  display_id?: string | number | null;
  display_number?: string | number | null;
  impact?: string | { name?: string | null } | null;
  id?: string | number | null;
  is_billable?: boolean | null;
  is_onsite?: boolean | null;
  item?: string | { name?: string | null } | null;
  onsite?: boolean | null;
  priority?: string | { name?: string | null } | null;
  number?: string | number | null;
  request_number?: string | null;
  request_id?: string | number | null;
  request_type?: string | { name?: string | null } | null;
  requester?: {
    email?: string | null;
    email_id?: string | null;
    id?: string | number | null;
    mobile?: string | null;
    mobile_number?: string | null;
    name?: string | null;
    phone?: string | null;
    phone_number?: string | null;
    contact_number?: string | null;
  } | null;
  requester_email?: string | null;
  requester_mobile?: string | null;
  requester_name?: string | null;
  requester_phone?: string | null;
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
    code?: string | null;
    country?: string | null;
    name?: string | null;
    postal_code?: string | null;
    state?: string | null;
    street?: string | null;
    zip?: string | null;
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
  urgency?: string | { name?: string | null } | null;
};

export type MspCentralRawCustomer = NonNullable<
  MspCentralRawRequest["account"]
> & {
  account_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  email_id?: string | null;
  phone?: string | null;
  phone_number?: string | null;
};

export type MspCentralRawContact = {
  account?: {
    id?: string | number | null;
    name?: string | null;
  } | null;
  account_id?: string | number | null;
  account_name?: string | null;
  contact_number?: string | null;
  customer?: {
    id?: string | number | null;
    name?: string | null;
  } | null;
  customer_id?: string | number | null;
  customer_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  email_id?: string | null;
  first_name?: string | null;
  id?: string | number | null;
  last_name?: string | null;
  mobile?: string | null;
  mobile_number?: string | null;
  name?: string | null;
  phone?: string | null;
  phone_number?: string | null;
};

export type MspCentralCustomerLookup = {
  address?: string;
  city?: string;
  email?: string;
  id: string;
  name: string;
  phone?: string;
};

export type MspCentralCreateCustomerInput = {
  address?: string;
  city?: string;
  country?: string;
  email?: string;
  name: string;
  phone?: string;
  postalCode?: string;
  state?: string;
};

export type MspCentralContactLookup = {
  email?: string;
  id: string;
  name: string;
  phone?: string;
};

export type MspCentralRequestFormOptions = {
  categories: string[];
  impacts: string[];
  priorities: Array<"Critical" | "High" | "Medium" | "Low">;
  requestTypes: string[];
  statuses: string[];
  subcategories: string[];
  technicians: string[];
  urgencies: string[];
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
  notes?: MspCentralRawRequestNote[];
  request_notes?: MspCentralRawRequestNote[];
};

export type MspCentralRawNotification = {
  description?: string | null;
  id?: string | number | null;
  sender?: {
    email_id?: string | null;
    name?: string | null;
  } | null;
  sent_time?: MspCentralTimestamp | null;
  subject?: string | null;
  time?: MspCentralTimestamp | null;
  to?: Array<{ email_id?: string | null }> | null;
  type?: string | null;
};

export type MspCentralRequestNotificationListResponse = {
  list_info?: MspCentralListInfo | null;
  notifications?: MspCentralRawNotification[];
};

export type MspCentralRequestNotificationDetailResponse = {
  notification?: MspCentralRawNotification;
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
  bodyHtml?: string;
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

export type MspCentralCustomerListResponse = {
  accounts?: MspCentralRawCustomer[];
  customers?: MspCentralRawCustomer[];
  list_info?: MspCentralListInfo | null;
};

export type MspCentralContactListResponse = {
  contacts?: MspCentralRawContact[];
  list_info?: MspCentralListInfo | null;
  requesters?: MspCentralRawContact[];
  users?: MspCentralRawContact[];
};

export type MspCentralNamedOption = {
  display_name?: string | null;
  id?: string | number | null;
  name?: string | null;
  value?: string | null;
};

export type MspCentralNamedOptionListResponse = {
  categories?: MspCentralNamedOption[];
  impacts?: MspCentralNamedOption[];
  list_info?: MspCentralListInfo | null;
  options?: MspCentralNamedOption[];
  priorities?: MspCentralNamedOption[];
  request_types?: MspCentralNamedOption[];
  statuses?: MspCentralNamedOption[];
  subcategories?: MspCentralNamedOption[];
  technicians?: MspCentralNamedOption[];
  urgencies?: MspCentralNamedOption[];
  values?: MspCentralNamedOption[];
};

export type MspCentralTechnicianListResponse = {
  technicians?: MspCentralRawTechnician[];
};

export type MspCentralListRequestsParams = {
  cacheOnly?: boolean;
  forceRefresh?: boolean;
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
  addRequestReply?(input: {
    actorEmail?: string;
    description: string;
    requestId: string;
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
    category?: string;
    commandFingerprint?: string;
    customer?: string;
    customerId?: string;
    contactId?: string;
    description?: string;
    impact?: string;
    impactDetails?: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    requestType?: string;
    requesterEmail?: string;
    site?: string;
    status?: string;
    subcategory?: string;
    subject: string;
    technicianEmail?: string;
    technicianId?: string;
    technicianName?: string;
    urgency?: string;
  }): Promise<{ id: string; requestNumber: string }>;
  findRequestByCommandFingerprint?(
    commandFingerprint: string,
  ): Promise<{ id: string; requestNumber: string } | undefined>;
  getRequest(requestId: string): Promise<DispatchRequest | undefined>;
  getRequestContext(requestId: string): Promise<MspCentralRequestContext>;
  getTechnician(technicianId: string): Promise<Technician | undefined>;
  listContacts?(input?: {
    customerId?: string;
    query?: string;
  }): Promise<MspCentralContactLookup[]>;
  createCustomer?(
    input: MspCentralCreateCustomerInput,
  ): Promise<MspCentralCustomerLookup>;
  listCustomers(query?: string): Promise<MspCentralCustomerLookup[]>;
  listRequestNotes?(
    requestId: string,
  ): Promise<MspCentralRawRequestNote[]>;
  listRequestNotifications?(
    requestId: string,
  ): Promise<MspCentralRawNotification[]>;
  listRequestFormOptions?(): Promise<MspCentralRequestFormOptions>;
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
