export type IntegrationErrorCode =
  | "ambiguous"
  | "authentication_required"
  | "conflict"
  | "permanent"
  | "retryable";

type ErrorOptions = {
  cause?: unknown;
  httpStatus?: number;
};

class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly httpStatus?: number;

  constructor(
    message: string,
    code: IntegrationErrorCode,
    httpStatusOrOptions?: number | ErrorOptions,
  ) {
    super(message, {
      cause:
        typeof httpStatusOrOptions === "object"
          ? httpStatusOrOptions.cause
          : undefined,
    });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus =
      typeof httpStatusOrOptions === "number"
        ? httpStatusOrOptions
        : httpStatusOrOptions?.httpStatus;
  }
}

export class RetryableIntegrationError extends IntegrationError {
  constructor(message: string, httpStatusOrOptions?: number | ErrorOptions) {
    super(message, "retryable", httpStatusOrOptions);
  }
}

export class AuthenticationIntegrationError extends IntegrationError {
  constructor(message: string, httpStatusOrOptions?: number | ErrorOptions) {
    super(message, "authentication_required", httpStatusOrOptions);
  }
}

export class PermanentIntegrationError extends IntegrationError {
  constructor(message: string, httpStatusOrOptions?: number | ErrorOptions) {
    super(message, "permanent", httpStatusOrOptions);
  }
}

export class ConflictIntegrationError extends IntegrationError {
  constructor(message: string, httpStatusOrOptions: number | ErrorOptions = 409) {
    super(message, "conflict", httpStatusOrOptions);
  }
}

export class AmbiguousIntegrationError extends IntegrationError {
  constructor(message: string, httpStatusOrOptions?: number | ErrorOptions) {
    super(message, "ambiguous", httpStatusOrOptions);
  }
}

export type ClassifiedIntegrationError =
  | RetryableIntegrationError
  | AuthenticationIntegrationError
  | PermanentIntegrationError
  | ConflictIntegrationError
  | AmbiguousIntegrationError;

export function classifyIntegrationError(
  error: unknown,
  { writeSafety = "idempotent" }: { writeSafety?: "idempotent" | "non_idempotent" } = {},
): ClassifiedIntegrationError {
  if (error instanceof IntegrationError) {
    if (writeSafety === "non_idempotent" && error.code === "retryable") {
      return new AmbiguousIntegrationError(error.message, {
        cause: error,
        httpStatus: error.httpStatus,
      });
    }
    return error;
  }

  const message = errorMessage(error);
  const httpStatus = errorHttpStatus(error);
  const networkFailure = isNetworkFailure(error);

  if (httpStatus === 401 || httpStatus === 403) {
    return new AuthenticationIntegrationError(message, { cause: error, httpStatus });
  }
  if (httpStatus === 409) {
    return new ConflictIntegrationError(message, { cause: error, httpStatus });
  }
  if (networkFailure || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)) {
    if (writeSafety === "non_idempotent") {
      return new AmbiguousIntegrationError(message, { cause: error, httpStatus });
    }
    return new RetryableIntegrationError(message, { cause: error, httpStatus });
  }
  if (httpStatus === 400 || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500)) {
    return new PermanentIntegrationError(message, { cause: error, httpStatus });
  }

  return new PermanentIntegrationError(message, { cause: error, httpStatus });
}

function errorHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  for (const key of ["status", "statusCode", "httpStatus"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Integration provider request failed.";
}

function isNetworkFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = Reflect.get(error, "code");
  if (
    typeof code === "string" &&
    ["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"].includes(
      code.toUpperCase(),
    )
  ) {
    return true;
  }
  return error instanceof TypeError && /fetch|network|socket|timeout/i.test(error.message);
}
