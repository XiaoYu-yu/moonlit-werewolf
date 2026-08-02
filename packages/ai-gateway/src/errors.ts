export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderRequestError';
  }
}

/**
 * Raised by a local runtime guard before an HTTP request starts. The gateway
 * may try another provider, but must not count this as a billable provider
 * call in operational telemetry.
 */
export class ProviderCallRejectedError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
  ) {
    super(message);
    this.name = 'ProviderCallRejectedError';
  }
}

export class InvalidStructuredActionError extends Error {
  constructor(
    message: string,
    readonly rawContent: string,
  ) {
    super(message);
    this.name = 'InvalidStructuredActionError';
  }
}

export class CostLimitExceededError extends Error {
  constructor(
    readonly requiredCents: number,
    readonly remainingCents: number,
  ) {
    super(`AI cost limit exceeded: required ${requiredCents}, remaining ${remainingCents}`);
    this.name = 'CostLimitExceededError';
  }
}
