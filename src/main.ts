/**
 * Main application entry point for HAG JavaScript variant.
 *
 * CLI application using @cliffy/command with traditional dependency injection.
 */

import { Command } from '@cliffy/command';
import {
  ApplicationContainer,
  createContainer,
  disposeContainer,
} from './core/container.ts';
import { TYPES } from './core/types.ts';
import { HVACController } from './hvac/controller.ts';
import { ConfigLoader } from './config/loader.ts';
import { extractErrorDetails } from './core/exceptions.ts';
import { type LevelName, type Logger } from '@std/log';
import { getAppLogger, setupLogging } from './core/logging.ts';
import { type ApplicationOptions } from './config/config.ts';
import { LogLevel } from './types/common.ts';

let logger: Logger;

/**
 * Global container instance
 */
let container: ApplicationContainer | undefined;

/**
 * Cleanup handler
 */
async function cleanup(): Promise<void> {
  if (container) {
    await disposeContainer();
  }
}

/**
 * Setup cleanup handlers
 */
function setupCleanup(): void {
  // Handle process termination
  Deno.addSignalListener('SIGINT', async () => {
    logger.info('🛑 Received SIGINT, shutting down gracefully...');
    await cleanup();
    Deno.exit(0);
  });

  Deno.addSignalListener('SIGTERM', async () => {
    logger.info('🛑 Received SIGTERM, shutting down gracefully...');
    await cleanup();
    Deno.exit(0);
  });

  // Handle unhandled errors
  globalThis.addEventListener('unhandledrejection', async (event) => {
    logger.error('❌ Unhandled promise rejection:', event.reason);
    await cleanup();
    Deno.exit(1);
  });

  globalThis.addEventListener('error', async (event) => {
    logger.error('❌ Unhandled error:', event.error);
    await cleanup();
    Deno.exit(1);
  });
}

/**
 * Run HAG application
 */
async function runApplication(
  configPath?: string,
  logLevel?: string,
): Promise<void> {
  try {
    // Create and initialize container
    container = await createContainer(configPath);
    const appOptions = container.get<ApplicationOptions>(
      TYPES.ApplicationOptions,
    );
    if (logLevel) {
      appOptions.logLevel = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel] || LogLevel.INFO;
    }
    // deno-lint-ignore no-explicit-any
    setupLogging(appOptions.logLevel as any);

    // Get HVAC controller
    const controller = container.get<HVACController>(TYPES.HVACController);

    // Start the controller
    await controller.start();

    logger.info('🏠 HAG HVAC automation is running...');
    logger.info('📊 Press Ctrl+C to stop gracefully');

    // Keep the application running
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    const details = extractErrorDetails(error);
    logger.error('❌ Application failed:', error, { message: details.message });
    throw error;
  }
}

/**
 * Validate configuration command
 */
async function validateConfig(configPath: string): Promise<void> {
  try {
    const result = await ConfigLoader.validateConfigFile(configPath);

    if (result.valid && result.config) {
      logger.info(`✅ Configuration is valid: ${configPath}`, {
        logLevel: result.config.appOptions.logLevel,
        aiEnabled: result.config.appOptions.useAi,
        tempSensor: result.config.hvacOptions.tempSensor,
        systemMode: result.config.hvacOptions.systemMode,
        hvacEntities: result.config.hvacOptions.hvacEntities.length,
      });
    } else {
      logger.error(
        `❌ Configuration validation failed: ${configPath}`,
        result.errors ? { errors: result.errors } : undefined,
      );
      Deno.exit(1);
    }
  } catch (error) {
    logger.error('❌ Configuration validation error:', error);
    Deno.exit(1);
  }
}

/**
 * Get system status
 */
async function getStatus(configPath?: string): Promise<void> {
  try {
    container = await createContainer(configPath);
    const controller = container.get<HVACController>(TYPES.HVACController);

    // Start controller briefly to get status
    await controller.start();
    const status = await controller.getStatus();
    await controller.stop();

    logger.info('📊 HAG System Status');
    logger.info('=' + '='.repeat(29));
    logger.info(`Controller Running: ${status.controller.running}`);
    logger.info(`HA Connected: ${status.controller.haConnected}`);
    logger.info(`Temperature Sensor: ${status.controller.tempSensor}`);
    logger.info(`System Mode: ${status.controller.systemMode}`);
    logger.info(`AI Enabled: ${status.controller.aiEnabled}`);

    if (status.stateMachine) {
      logger.info(`State Machine: ${status.stateMachine.currentState}`);
      if (status.stateMachine.hvacMode) {
        logger.info(`HVAC Mode: ${status.stateMachine.hvacMode}`);
      }

      if (status.stateMachine.conditions) {
        const conditions = status.stateMachine.conditions;
        if (conditions.indoorTemp) {
          logger.info(`Indoor Temp: ${conditions.indoorTemp}°C`);
        }
        if (conditions.outdoorTemp) {
          logger.info(`Outdoor Temp: ${conditions.outdoorTemp}°C`);
        }
      }
    }

    if (status.aiAnalysis) {
      logger.info(`AI Analysis:\n${status.aiAnalysis}`);
    }
  } catch (error) {
    logger.error('❌ Failed to get status:', error);
    Deno.exit(1);
  }
}

/**
 * Manual override command
 */
async function manualOverride(
  action: string,
  configPath?: string,
  temperature?: number,
): Promise<void> {
  try {
    container = await createContainer(configPath);
    const controller = container.get<HVACController>(TYPES.HVACController);

    await controller.start();

    const options: Record<string, unknown> = {};
    if (temperature !== undefined) {
      options.temperature = temperature;
    }

    const result = await controller.manualOverride(action, options);

    if (result.success) {
      logger.info(
        `✅ Manual override successful: ${action}`,
        temperature ? { temperature } : undefined,
      );
    } else {
      logger.error(`❌ Manual override failed: ${result.error}`);
      Deno.exit(1);
    }

    await controller.stop();
  } catch (error) {
    logger.error('❌ Manual override error:', error);
    Deno.exit(1);
  }
}

/**
 * Show environment information
 */
function showEnvironment(): void {
  const envInfo = ConfigLoader.getEnvironmentInfo();

  logger.info('🌍 Environment Information');
  logger.info('=' + '='.repeat(26));
  logger.info('Deno:', { deno: envInfo.deno });
  logger.info('Platform:', { platform: envInfo.platform });
  logger.info('Environment:', { environment: envInfo.environment });
}

/**
 * Main CLI setup
 */
async function main(): Promise<void> {
  const cli = new Command()
    .name('hag')
    .description('🏠 HAG - Home Assistant aGentic HVAC Automation')
    .version('1.0.0')
    .option('-c, --config <file>', 'Configuration file path')
    .option('--log-level <level>', 'Log level (debug, info, warning, error)', {
      default: 'info',
      global: true,
    })
    .action(async (options) => {
      setupLogging(options.logLevel as LevelName);
      logger = getAppLogger();
      logger.debug('Starting HAG application main function...');
      await runApplication(options.config, options.logLevel);
    })
    .command('validate', 'Validate configuration file')
    .option('-c, --config <file>', 'Configuration file path', {
      required: true,
    })
    .action(async (options) => {
      setupLogging(options.logLevel as LevelName);
      logger = getAppLogger();
      await validateConfig(options.config);
    })
    .command('status', 'Get system status')
    .option('-c, --config <file>', 'Configuration file path')
    .action(async (options) => {
      setupLogging(options.logLevel as LevelName);
      logger = getAppLogger();
      await getStatus(options.config);
    })
    .command('override <action>', 'Manual HVAC override (heat, cool, off)')
    .option('-c, --config <file>', 'Configuration file path')
    .option('-t, --temperature <temp:number>', 'Target temperature')
    .action(async (options, action) => {
      setupLogging(options.logLevel as LevelName);
      logger = getAppLogger();
      await manualOverride(action, options.config, options.temperature);
    })
    .command('env', 'Show environment information')
    .action(() => {
      setupLogging('info' as LevelName);
      logger = getAppLogger();
      showEnvironment();
    });

  setupCleanup();

  try {
    await cli.parse(Deno.args);
  } catch (error) {
    if (!logger) {
      setupLogging('error' as LevelName);
      logger = getAppLogger();
    }
    logger.error('❌ CLI error:', error);
    await cleanup();
    Deno.exit(1);
  }
}

// Run the CLI
if (import.meta.main) {
  main().catch(async (error) => {
    console.error('❌ Application error:', error);
    if (logger) {
      logger.error('❌ Application error:', error);
    }
    await cleanup();
    Deno.exit(1);
  });
}

