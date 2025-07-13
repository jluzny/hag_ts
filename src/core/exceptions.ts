/**
 * Core exception classes for HAG JavaScript variant.
 *
 * Traditional TypeScript error handling with class-based exceptions.
 */

export class HAGError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HAGError';

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HAGError);
    }
  }
}

export class StateError extends HAGError {
  constructor(
    message: string,
    public readonly state?: string,
    public readonly entityId?: string,
  ) {
    super(message, 'STATE_ERROR');
    this.name = 'StateError';
  }
}

export class ConfigurationError extends HAGError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
  ) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class ConnectionError extends HAGError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly retryAttempt?: number,
  ) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

export class ValidationError extends HAGError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly expectedType?: string,
    public readonly actualValue?: unknown,
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class HVACOperationError extends HAGError {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly entityId?: string,
  ) {
    super(message, 'HVAC_OPERATION_ERROR');
    this.name = 'HVACOperationError';
  }
}

export class AIError extends HAGError {
  constructor(
    message: string,
    public readonly model?: string,
    public readonly context?: string,
  ) {
    super(message, 'AI_ERROR');
    this.name = 'AIError';
  }
}

/**
 * Utility function to check if an error is a HAG-specific error
 */
export function isHAGError(error: unknown): error is HAGError {
  return error instanceof HAGError;
}

/**
 * Utility function to extract error details for logging
 */
export function extractErrorDetails(error: unknown): {
  message: string;
  name: string;
  code?: string;
  stack?: string;
} {
  if (isHAGError(error)) {
    return {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
    name: 'UnknownError',
  };
}

/**
 * Utility to safely get error message from unknown error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Utility to ensure we have an Error object
 */
export function toError(error: unknown, fallbackMessage = 'Unknown error'): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(`${fallbackMessage}: ${String(error)}`);
}
