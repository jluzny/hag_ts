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
    // Note: Using console.log here since we don't have logger instance
    // console.log('📍 HAGError.constructor() ENTRY');
    super(message);
    this.name = 'HAGError';

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HAGError);
    }
    // console.log('📍 HAGError.constructor() EXIT');
  }
}

export class StateError extends HAGError {
  constructor(
    message: string,
    public readonly state?: string,
    public readonly entityId?: string,
  ) {
    // console.log('📍 StateError.constructor() ENTRY');
    super(message, 'STATE_ERROR');
    this.name = 'StateError';
    // console.log('📍 StateError.constructor() EXIT');
  }
}

export class ConfigurationError extends HAGError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
  ) {
    // console.log('📍 ConfigurationError.constructor() ENTRY');
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
    // console.log('📍 ConfigurationError.constructor() EXIT');
  }
}

export class ConnectionError extends HAGError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly retryAttempt?: number,
  ) {
    // console.log('📍 ConnectionError.constructor() ENTRY');
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
    // console.log('📍 ConnectionError.constructor() EXIT');
  }
}

export class ValidationError extends HAGError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly expectedType?: string,
    public readonly actualValue?: unknown,
  ) {
    // console.log('📍 ValidationError.constructor() ENTRY');
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    // console.log('📍 ValidationError.constructor() EXIT');
  }
}

export class HVACOperationError extends HAGError {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly entityId?: string,
  ) {
    // console.log('📍 HVACOperationError.constructor() ENTRY');
    super(message, 'HVAC_OPERATION_ERROR');
    this.name = 'HVACOperationError';
    // console.log('📍 HVACOperationError.constructor() EXIT');
  }
}

export class AIError extends HAGError {
  constructor(
    message: string,
    public readonly model?: string,
    public readonly context?: string,
  ) {
    // console.log('📍 AIError.constructor() ENTRY');
    super(message, 'AI_ERROR');
    this.name = 'AIError';
    // console.log('📍 AIError.constructor() EXIT');
  }
}

/**
 * Utility function to check if an error is a HAG-specific error
 */
export function isHAGError(error: unknown): error is HAGError {
  // console.log('📍 isHAGError() ENTRY');
  const result = error instanceof HAGError;
  // console.log('📍 isHAGError() EXIT');
  return result;
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
  // console.log('📍 extractErrorDetails() ENTRY');
  if (isHAGError(error)) {
    const result = {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
    };
    // console.log('📍 extractErrorDetails() EXIT');
    return result;
  }

  if (error instanceof Error) {
    const result = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
    // console.log('📍 extractErrorDetails() EXIT');
    return result;
  }

  const result = {
    message: String(error),
    name: 'UnknownError',
  };
  // console.log('📍 extractErrorDetails() EXIT');
  return result;
}
