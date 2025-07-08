/**
 * Comprehensive logging system for HAG JavaScript variant.
 * 
 * This module provides both low-level logging setup using @std/log and
 * a high-level LoggerService class with structured logging capabilities.
 * Enhanced with colored, emoji-aware formatting similar to Python structlog.
 */

import { injectable } from '@needle-di/core';
import {
  ConsoleHandler,
  getLogger,
  type LevelName,
  type Logger,
  type LogRecord,
  setup,
} from '@std/log';
import {
  blue,
  bold,
  cyan,
  dim,
  green,
  magenta,
  red,
  yellow,
} from '@std/fmt/colors';

export interface LogContext {
  [key: string]: unknown;
}

/**
 * Custom formatter that provides structured, colored logging similar to Python structlog
 */
function structuredColoredFormatter(record: LogRecord): string {
  // Format timestamp (HH:MM:SS)
  const timestamp = dim(
    cyan(`[${record.datetime.toISOString().substr(11, 8)}]`),
  );

  // Color level based on severity
  const levelColor = getLevelColor(record.level);
  const coloredLevel = levelColor(`${record.levelName}`.padEnd(7));

  // Add logger name
  const loggerName = magenta(`[${record.loggerName}]`);

  // Format main message with emoji-based coloring
  const coloredMessage = formatMessageWithEmojis(String(record.msg));

  // Format structured context from args
  const context = record.args.length > 0 ? formatContext(record.args) : '';

  return `${timestamp} ${coloredLevel} ${loggerName} ${coloredMessage}${context}`;
}

function getLevelColor(level: number): (str: string) => string {
  switch (level) {
    case 10: // DEBUG
      return cyan;
    case 20: // INFO
      return blue;
    case 30: // WARNING
      return yellow;
    case 40: // ERROR
      return red;
    case 50: // CRITICAL
      return (str: string) => red(bold(str));
    default:
      return (str: string) => str;
  }
}

function formatMessageWithEmojis(message: string): string {
  // HVAC-specific emoji coloring (similar to Python version)
  if (message.includes('🔥') || message.toLowerCase().includes('heating')) {
    return red(bold(message));
  }
  if (message.includes('❄️') || message.toLowerCase().includes('cooling')) {
    return cyan(bold(message));
  }
  if (
    message.includes('⏸️') || message.toLowerCase().includes('off') ||
    message.toLowerCase().includes('idle')
  ) {
    return dim(message);
  }
  if (message.includes('🎯') || message.toLowerCase().includes('decision')) {
    return yellow(bold(message));
  }
  if (message.includes('✅') || message.toLowerCase().includes('execution')) {
    return green(bold(message));
  }
  if (
    message.includes('🔍') || message.toLowerCase().includes('state machine')
  ) {
    return magenta(bold(message));
  }
  if (message.includes('🚀') || message.toLowerCase().includes('starting')) {
    return green(bold(message));
  }
  if (message.includes('🛑') || message.toLowerCase().includes('stopping')) {
    return red(bold(message));
  }
  return message;
}

function formatContext(args: unknown[]): string {
  if (args.length === 0) return '';

  const contextStr = args
    .map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        return Object.entries(arg)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(' ');
      }
      return String(arg);
    })
    .filter(Boolean)
    .join(' ');

  return contextStr ? ` ${dim(green(`{${contextStr}}`))}` : '';
}

/**
 * Setup global logging configuration with structured colored formatting
 */
export function setupLogging(logLevel: LevelName = 'INFO') {
  const level = logLevel.toUpperCase() as LevelName;
  setup({
    handlers: {
      console: new ConsoleHandler(level, {
        formatter: structuredColoredFormatter,
        useColors: false, // We handle colors in our custom formatter
      }),
    },
    loggers: {
      default: {
        level: level,
        handlers: ['console'],
      },
      HAG: {
        level: level,
        handlers: ['console'],
      },
      'HAG.core': {
        level: level,
        handlers: ['console'],
      },
      'HAG.container': {
        level: level,
        handlers: ['console'],
      },
      'HAG.module-registry': {
        level: level,
        handlers: ['console'],
      },
      'HAG.event-bus': {
        level: level,
        handlers: ['console'],
      },
      'HAG.home-assistant.client': {
        level: level,
        handlers: ['console'],
      },
      'HAG.hvac': {
        level: level,
        handlers: ['console'],
      },
      'HAG.hvac.controller': {
        level: level,
        handlers: ['console'],
      },
      'HAG.hvac.state-machine': {
        level: level,
        handlers: ['console'],
      },
      'HAG.hvac.heating-strategy': {
        level: level,
        handlers: ['console'],
      },
      'HAG.hvac.cooling-strategy': {
        level: level,
        handlers: ['console'],
      },
      'HAG.ai': {
        level: level,
        handlers: ['console'],
      },
      ConfigLoader: {
        level: level,
        handlers: ['console'],
      },
      test: {
        level: level,
        handlers: ['console'],
      },
    },
  });
}

/**
 * Get the main application logger
 */
export function getAppLogger() {
  return getLogger('HAG');
}

/**
 * Enhanced Logger service wrapper with structured logging using native @std/log features
 * 
 * This class provides a high-level interface for structured logging with context support,
 * built on top of the native @std/log Logger implementation.
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

  /**
   * Get the underlying native @std/log Logger instance
   * Useful for advanced use cases that need direct access
   */
  getUnderlyingLogger(): Logger {
    return this.logger;
  }
}