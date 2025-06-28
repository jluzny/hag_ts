
/**
 * Logging setup for HAG JavaScript variant.
 * Enhanced with structured logging capabilities using native @std/log features.
 */

import { 
  setup, 
  getLogger, 
  type LevelName, 
  ConsoleHandler,
  type LogRecord 
} from '@std/log';
import { dim, cyan, blue, yellow, red, bold, green, magenta } from '@std/fmt/colors';

export interface LogContext {
  [key: string]: unknown;
}

/**
 * Custom formatter that provides structured, colored logging similar to Python structlog
 */
function structuredColoredFormatter(record: LogRecord): string {
  // Format timestamp (HH:MM:SS)
  const timestamp = dim(cyan(`[${record.datetime.toISOString().substr(11, 8)}]`));
  
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
  if (message.includes('⏸️') || message.toLowerCase().includes('off') || message.toLowerCase().includes('idle')) {
    return dim(message);
  }
  if (message.includes('🎯') || message.toLowerCase().includes('decision')) {
    return yellow(bold(message));
  }
  if (message.includes('✅') || message.toLowerCase().includes('execution')) {
    return green(bold(message));
  }
  if (message.includes('🔍') || message.toLowerCase().includes('state machine')) {
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
    .map(arg => {
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
    },
  });
}

export function getAppLogger() {
  return getLogger('HAG');
}
