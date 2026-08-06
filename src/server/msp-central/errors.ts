export class MspCentralConfigurationError extends Error {
  readonly status?: number;

  constructor(
    message = "MSP Central API not configured.",
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MspCentralConfigurationError";
    this.status = options.status;
  }
}
