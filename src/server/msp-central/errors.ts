export class MspCentralConfigurationError extends Error {
  constructor(message = "MSP Central API not configured.") {
    super(message);
    this.name = "MspCentralConfigurationError";
  }
}
