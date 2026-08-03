export type IntegrationConnector =
  | "command_centre"
  | "msp_central"
  | "outlook"
  | "zoho_crm"
  | "msp_endpoint"
  | "zoho_survey"
  | "push"
  | "email";

export type EnqueueIntegrationOperation = {
  actionType: string;
  actorEmail: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  requestId?: string;
  sourceVersion?: string;
  steps: Array<{
    action: string;
    connector: IntegrationConnector;
    payload: Record<string, unknown>;
    stepKey: string;
  }>;
};

export type IntegrationOperationState =
  | "queued"
  | "syncing"
  | "retrying"
  | "synced"
  | "review_required"
  | "cancelled";

export type IntegrationStepState =
  | "queued"
  | "processing"
  | "retrying"
  | "succeeded"
  | "review_required"
  | "cancelled";

export type IntegrationOperation = {
  actionType: string;
  actorEmail: string;
  attemptCount: number;
  cancelledAt?: string;
  createdAt: string;
  id: string;
  idempotencyKey: string;
  inputFingerprint: string;
  lastError?: string;
  payload: Record<string, unknown>;
  requestId: string;
  sourceVersion?: string;
  state: IntegrationOperationState;
  syncedAt?: string;
  updatedAt: string;
};

export type IntegrationOperationStep = {
  action: string;
  attemptCount: number;
  completedAt?: string;
  connector: IntegrationConnector;
  createdAt: string;
  id: string;
  lastError?: string;
  leaseExpiresAt?: string;
  leaseToken?: string;
  nextAttemptAt?: string;
  operationId: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  startedAt?: string;
  state: IntegrationStepState;
  stepKey: string;
  stepOrder: number;
  updatedAt: string;
  workerId?: string;
};

export type IntegrationAuditEvent = {
  attemptCount?: number;
  connector?: IntegrationConnector;
  durationMs?: number;
  errorCode?: string;
  eventType: string;
  httpStatus?: number;
  operationId?: string;
  outcome?: string;
  requestId: string;
  stepKey?: string;
};

export type IntegrationConnectorHealth = {
  connector: IntegrationConnector;
  consecutiveFailures: number;
  lastCheckedAt?: string;
  lastError?: string;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  status: IntegrationConnectorHealthStatus;
};

export type IntegrationConnectorHealthStatus =
  | "authentication_required"
  | "degraded"
  | "healthy"
  | "stale"
  | "unavailable"
  | "unknown";
