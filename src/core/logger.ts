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
    // Use the underlying logger for debug to avoid infinite recursion
    this.logger.debug('📍 LoggerService.constructor() ENTRY');
    this.logger.debug('📍 LoggerService.constructor() EXIT');
  }

  /**
   * Log info level with structured context
   * Uses native @std/log structured logging via args parameter
   */
  info(message: string, context?: LogContext): void {
    this.logger.debug('📍 LoggerService.info() ENTRY');
    if (context) {
      this.logger.info(message, context);
    } else {
      this.logger.info(message);
    }
    this.logger.debug('📍 LoggerService.info() EXIT');
  }

  /**
   * Log error with enhanced context and stack trace
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    this.logger.debug('📍 LoggerService.error() ENTRY');
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
    this.logger.debug('📍 LoggerService.error() EXIT');
  }

  /**
   * Log debug level with detailed context
   */
  debug(message: string, context?: LogContext): void {
    // Skip ENTRY/EXIT logging for debug method to avoid infinite recursion
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
    this.logger.debug('📍 LoggerService.warning() ENTRY');
    if (context) {
      this.logger.warn(message, context);
    } else {
      this.logger.warn(message);
    }
    this.logger.debug('📍 LoggerService.warning() EXIT');
  }
}
