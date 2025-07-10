/**
 * Comprehensive logging system for HAG Bun variant.
 * 
 * This module provides a simplified logging system compatible with Bun runtime.
 */

import { injectable } from '@needle-di/core';

export interface LogContext {
  [key: string]: unknown;
}

export type LevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Color functions for console output
const colors = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
}

class SimpleLogger implements Logger {
  constructor(private name: string, private level: LevelName = 'INFO') {}

  private shouldLog(level: LevelName): boolean {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: LevelName, message: string, context?: LogContext, error?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelColor = {
      DEBUG: colors.dim,
      INFO: colors.blue,
      WARN: colors.yellow,
      ERROR: colors.red,
    }[level];

    let formatted = `${colors.dim(timestamp)} ${levelColor(level.padEnd(5))} ${colors.cyan(this.name)} ${message}`;
    
    if (context && Object.keys(context).length > 0) {
      formatted += ` ${colors.dim(JSON.stringify(context))}`;
    }
    
    if (error) {
      if (error instanceof Error) {
        formatted += `\n${colors.red(error.stack || error.message)}`;
      } else {
        formatted += `\n${colors.red(String(error))}`;
      }
    }
    
    return formatted;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('DEBUG')) {
      console.log(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('INFO')) {
      console.log(this.formatMessage('INFO', message, context));
    }
  }

  warning(message: string, context?: LogContext): void {
    if (this.shouldLog('WARN')) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog('ERROR')) {
      console.error(this.formatMessage('ERROR', message, context, error));
    }
  }
}

let globalLogLevel: LevelName = 'INFO';
const loggers = new Map<string, Logger>();

export function setupLogging(level: LevelName): void {
  globalLogLevel = level;
  // Clear existing loggers so they get recreated with the new level
  loggers.clear();
}

/**
 * Get current global log level
 */
export function getLogLevel(): LevelName {
  return globalLogLevel;
}

/**
 * Check if a log level is enabled
 */
export function isLogLevelEnabled(level: LevelName): boolean {
  const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
  return levels[level] >= levels[globalLogLevel];
}

export function getAppLogger(): Logger {
  return getLogger('HAG');
}

export function getLogger(name: string): Logger {
  if (!loggers.has(name)) {
    loggers.set(name, new SimpleLogger(name, globalLogLevel));
  }
  return loggers.get(name)!;
}

@injectable()
export class LoggerService implements Logger {
  private logger: Logger;

  constructor(name: string = 'HAG') {
    this.logger = getLogger(name);
  }

  /**
   * Create a child logger with a specific name
   */
  child(name: string): Logger {
    return getLogger(name);
  }

  /**
   * Check if debug level is enabled
   */
  isDebugEnabled(): boolean {
    return isLogLevelEnabled('DEBUG');
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  warning(message: string, context?: LogContext): void {
    this.logger.warning(message, context);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.logger.error(message, error, context);
  }
}