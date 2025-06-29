import { injectable } from '@needle-di/core';
import { getLogger, type Logger } from '@std/log';
import type { LogContext } from './logging.ts';

/**
 * Enhanced Logger service wrapper with structured logging using native @std/log features
 */
@injectable()
export class LoggerService {
  private logger: Logger;

  constructor(loggerName: string = 'HAG') {
    this.logger = getLogger(loggerName);
  }

  /**
   * Log info level with structured context
   * Uses native @std/log structured logging via args parameter
   */
  info(message: string, context?: LogContext): void {
    if (context) {
      this.logger.info(message, context);
    } else {
      this.logger.info(message);
    }
  }

  /**
   * Log error with enhanced context and stack trace
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.error = error.message;
      if (error.stack) {
        errorContext.stack = error.stack;
      }
    } else if (error) {
      errorContext.error = String(error);
    }

    this.logger.error(message, errorContext);
  }

  /**
   * Log debug level with detailed context
   */
  debug(message: string, context?: LogContext): void {
    if (context) {
      this.logger.debug(message, context);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * Log warning with context
   */
  warning(message: string, context?: LogContext): void {
    if (context) {
      this.logger.warn(message, context);
    } else {
      this.logger.warn(message);
    }
  }
}
