/**
 * Enhanced Logger service for HAG JavaScript variant.
 * 
 * Provides structured logging with contextual information similar to Python structlog.
 * Supports emojis, colored output, and detailed tracing for HVAC operations.
 */

import { injectable } from '@needle-di/core';
import { getLogger, Logger } from '@std/log';

export interface LogContext {
  [key: string]: unknown;
}

export interface HVACLogContext extends LogContext {
  currentState?: string;
  targetState?: string;
  indoorTemp?: number;
  outdoorTemp?: number;
  systemMode?: string;
  entityId?: string;
  hvacMode?: string;
  temperature?: number;
  reasoning?: string;
}

export interface ConnectionLogContext extends LogContext {
  wsUrl?: string;
  restUrl?: string;
  attempt?: number;
  readyState?: number;
  readyStateString?: string;
  messageType?: string;
  messageId?: number;
  timestamp?: string;
}

export interface PerformanceLogContext extends LogContext {
  processingTimeMs?: number;
  success?: boolean;
  entitiesControlled?: number;
  duration?: number;
}

/**
 * Enhanced Logger service wrapper with structured logging
 */
@injectable()
export class LoggerService {
  private logger: Logger;
  private module: string;

  constructor() {
    this.logger = getLogger('HAG');
    this.module = 'core';
  }

  /**
   * Create a module-specific logger instance
   */
  static createModuleLogger(moduleName: string): LoggerService {
    const instance = new LoggerService();
    instance.module = moduleName;
    instance.logger = getLogger(`HAG.${moduleName}`);
    return instance;
  }

  /**
   * Format structured log message with context
   */
  private formatMessage(message: string, context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) {
      return `[${this.module}] ${message}`;
    }

    const contextStr = Object.entries(context)
      .map(([key, value]) => {
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') {
          return `${key}=${JSON.stringify(value)}`;
        }
        return `${key}=${value}`;
      })
      .filter(Boolean)
      .join(' ');

    return `[${this.module}] ${message} {${contextStr}}`;
  }

  /**
   * Log info level with structured context
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(this.formatMessage(message, context));
  }

  /**
   * Log error with enhanced context and stack trace
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };
    
    if (error instanceof Error) {
      errorContext.error = error.message;
      errorContext.stack = error.stack;
    } else if (error) {
      errorContext.error = String(error);
    }

    this.logger.error(this.formatMessage(message, errorContext));
  }

  /**
   * Log debug level with detailed context
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(this.formatMessage(message, context));
  }

  /**
   * Log warning with context
   */
  warning(message: string, context?: LogContext): void {
    this.logger.warn(this.formatMessage(message, context));
  }

  /**
   * Log HVAC-specific operations with emoji indicators
   */
  hvacInfo(message: string, context?: HVACLogContext): void {
    this.info(`🏠 ${message}`, context);
  }

  /**
   * Log HVAC state transitions with emoji
   */
  hvacTransition(fromState: string, toState: string, context?: HVACLogContext): void {
    this.info(`🔄 HVAC Transition: ${fromState} → ${toState}`, context);
  }

  /**
   * Log HVAC decisions with reasoning
   */
  hvacDecision(decision: string, reasoning: string, context?: HVACLogContext): void {
    this.info(`🎯 HVAC Decision: ${decision}`, { ...context, reasoning });
  }

  /**
   * Log HVAC actions with results
   */
  hvacAction(action: string, success: boolean, context?: HVACLogContext): void {
    const emoji = success ? '✅' : '❌';
    this.info(`${emoji} HVAC Action: ${action}`, { ...context, success });
  }

  /**
   * Log connection events with status
   */
  connectionInfo(message: string, context?: ConnectionLogContext): void {
    this.info(`🔌 ${message}`, context);
  }

  /**
   * Log performance metrics
   */
  performance(operation: string, context?: PerformanceLogContext): void {
    this.info(`⚡ Performance: ${operation}`, context);
  }

  /**
   * Log AI operations
   */
  aiInfo(message: string, context?: LogContext): void {
    this.info(`🤖 AI: ${message}`, context);
  }

  /**
   * Log temperature readings
   */
  temperatureReading(sensorType: string, value: number, context?: LogContext): void {
    const emoji = sensorType.includes('outdoor') ? '🌡️' : '🏠';
    this.info(`${emoji} Temperature: ${sensorType} = ${value}°C`, context);
  }

  /**
   * Log state machine evaluation
   */
  stateMachineEvaluation(
    currentState: string, 
    targetState: string, 
    conditions: HVACLogContext
  ): void {
    this.info(`🔍 State Machine: Evaluating transition`, {
      currentState,
      targetState,
      ...conditions
    });
  }

  /**
   * Log evaluation completion with results
   */
  evaluationComplete(
    previousState: string,
    currentState: string,
    hvacMode: string,
    stateChanged: boolean,
    context?: HVACLogContext
  ): void {
    this.info(`✅ Evaluation Complete`, {
      previousState,
      currentState,
      hvacMode,
      stateChanged,
      ...context
    });
  }
}