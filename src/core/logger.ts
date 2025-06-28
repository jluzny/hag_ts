/**
 * Logger service wrapper for HAG JavaScript variant.
 * 
 * Separated to avoid circular dependencies.
 */

import { injectable } from '@needle-di/core';
import { getLogger, Logger } from '@std/log';

/**
 * Logger service wrapper
 */
@injectable()
export class LoggerService {
  private logger: Logger;

  constructor() {
    this.logger = getLogger('HAG');
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(data ? `${message} ${JSON.stringify(data)}` : message);
  }

  error(message: string, error?: unknown): void {
    this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ? `${message} ${JSON.stringify(data)}` : message);
  }

  warning(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ? `${message} ${JSON.stringify(data)}` : message);
  }
}