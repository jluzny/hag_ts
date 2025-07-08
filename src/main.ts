/**
 * Main application entry point for HAG JavaScript variant.
 *
 * CLI application using @std/cli/parse-args with traditional dependency injection.
 */

import { parseArgs } from '@std/cli/parse-args';
import {
  ApplicationContainer,
  createContainer,
  disposeContainer,
} from './core/container.ts';
import { TYPES } from './core/types.ts';
import { HvacModule } from './hvac/hvac-module.ts';
import { ModuleRegistry } from './core/module-registry.ts';
import { ConfigLoader } from './config/loader.ts';
import { extractErrorDetails } from './core/exceptions.ts';
import { type LevelName, type Logger } from '@std/log';
import { getAppLogger, setupLogging } from './core/logging.ts';
import { LogLevel } from './types/common.ts';

let logger: Logger;

/**
 * Global container instance
 */
let container: ApplicationContainer | undefined;

/**
 * Module registry for managing application modules
 */
let moduleRegistry: ModuleRegistry | undefined;

/**
 * Cleanup handler
 */
async function cleanup(): Promise<void> {
  logger?.debug('📍 cleanup() ENTRY');
  if (moduleRegistry) {
    await moduleRegistry.disposeAll();
  }
  if (container) {
    await disposeContainer();
  }
  logger?.debug('📍 cleanup() EXIT');
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
  logger?.debug('📍 runApplication() ENTRY');
  try {
    // Load configuration first to get log level before creating container
    const config = await ConfigLoader.loadSettings(configPath);
    
    // Apply CLI log level override if provided
    if (logLevel) {
      config.appOptions.logLevel =
        LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel] ||
        LogLevel.INFO;
    }
    
    // Setup logging before creating container
    // deno-lint-ignore no-explicit-any
    setupLogging(config.appOptions.logLevel as any);
    logger = getAppLogger();
    
    // Create and initialize container with pre-loaded config
    container = await createContainer(configPath);

    // Get module registry from container
    moduleRegistry = container.get<ModuleRegistry>(TYPES.ModuleRegistry);
    logger?.debug('📍 Retrieved module registry from container');

    // Get HVAC module from registry
    const hvacModule = moduleRegistry.getModule('hvac') as HvacModule;
    if (!hvacModule) {
      throw new Error('HVAC module not found in registry');
    }
    logger?.debug('📍 Retrieved HVAC module from registry');

    // Get controller from module
    const controller = hvacModule.getHVACController();
    logger?.debug('📍 Retrieved HVAC controller from module');

    // Start the controller
    await controller.start();
    logger?.debug('📍 HVAC controller started successfully');

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
  } finally {
    logger?.debug('📍 runApplication() EXIT');
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
  logger?.debug('📍 getStatus() ENTRY');
  try {
    container = await createContainer(configPath);
    
    // Get module registry from container
    moduleRegistry = container.get<ModuleRegistry>(TYPES.ModuleRegistry);
    logger?.debug('📍 Retrieved module registry for status check');
    
    // Get HVAC module from registry
    const hvacModule = moduleRegistry.getModule('hvac') as HvacModule;
    if (!hvacModule) {
      throw new Error('HVAC module not found in registry');
    }
    logger?.debug('📍 Retrieved HVAC module for status check');
    
    const controller = hvacModule.getHVACController();
    logger?.debug('📍 Retrieved HVAC controller for status check');

    // Start controller briefly to get status
    await controller.start();
    const status = controller.getStatus();
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
    }

    // Trigger an evaluation to ensure the system is up-to-date
    await controller.triggerEvaluation();

  } catch (error) {
    logger.error('❌ Failed to get status:', error);
    Deno.exit(1);
  } finally {
    logger?.debug('📍 getStatus() EXIT');
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
  logger?.debug('📍 manualOverride() ENTRY');
  try {
    container = await createContainer(configPath);
    
    // Get module registry from container
    moduleRegistry = container.get<ModuleRegistry>(TYPES.ModuleRegistry);
    logger?.debug('📍 Retrieved module registry for manual override');
    
    // Get HVAC module from registry
    const hvacModule = moduleRegistry.getModule('hvac') as HvacModule;
    if (!hvacModule) {
      throw new Error('HVAC module not found in registry');
    }
    logger?.debug('📍 Retrieved HVAC module for manual override');
    
    const controller = hvacModule.getHVACController();
    logger?.debug('📍 Retrieved HVAC controller for manual override');

    await controller.start();

    const options: Record<string, unknown> = { mode: action };
    if (temperature !== undefined) {
      options.temperature = temperature;
    }

    const result = controller.manualOverride(action, options);

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
  } finally {
    logger?.debug('📍 manualOverride() EXIT');
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
 * Show help message
 */
function showHelp(): void {
  console.log(`🏠 HAG - Home Assistant aGentic HVAC Automation v1.0.0

Usage: hag [command] [options]

Commands:
  (default)             Start the HAG HVAC automation system
  validate              Validate configuration file
  status                Get system status
  override <action>     Manual HVAC override (heat, cool, off)
  env                   Show environment information

Options:
  -c, --config <file>   Configuration file path
  --log-level <level>   Log level (debug, info, warning, error) [default: info]
  -t, --temperature <temp>  Target temperature (for override command)
  -h, --help            Show this help message
  -v, --version         Show version information

Examples:
  hag                                    # Start the system
  hag --config /path/to/config.yaml     # Start with custom config
  hag validate --config config.yaml     # Validate configuration
  hag status                             # Get system status
  hag override heat --temperature 22    # Override to heating mode at 22°C
  hag env                                # Show environment info
`);
}

/**
 * Main CLI setup
 */
async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    boolean: ['help', 'version'],
    string: ['config', 'log-level', 'temperature'],
    alias: {
      h: 'help',
      v: 'version',
      c: 'config',
      t: 'temperature',
    },
    default: {
      'log-level': 'info',
    },
    unknown: (arg: string) => {
      // Allow known commands as unknown args
      return ['validate', 'status', 'override', 'env', 'heat', 'cool', 'off']
        .includes(arg);
    },
  });

  if (args.help) {
    showHelp();
    return;
  }

  if (args.version) {
    console.log('HAG v1.0.0');
    return;
  }

  setupCleanup();

  try {
    const command = args._[0] as string;
    const logLevel = args['log-level'] as string;

    switch (command) {
      case 'validate': {
        if (!args.config) {
          console.error('❌ Error: --config is required for validate command');
          console.error('Usage: hag validate --config <file>');
          Deno.exit(1);
        }
        setupLogging(logLevel as LevelName);
        logger = getAppLogger();
        await validateConfig(args.config);
        break;
      }

      case 'status': {
        setupLogging(logLevel as LevelName);
        logger = getAppLogger();
        await getStatus(args.config);
        break;
      }

      case 'override': {
        const action = args._[1] as string;
        if (!action || !['heat', 'cool', 'off'].includes(action)) {
          console.error(
            '❌ Error: override command requires action (heat, cool, off)',
          );
          console.error(
            'Usage: hag override <action> [--config <file>] [--temperature <temp>]',
          );
          Deno.exit(1);
        }
        setupLogging(logLevel as LevelName);
        logger = getAppLogger();
        const temperature = args.temperature
          ? parseFloat(args.temperature)
          : undefined;
        await manualOverride(action, args.config, temperature);
        break;
      }

      case 'env': {
        setupLogging('info' as LevelName);
        logger = getAppLogger();
        showEnvironment();
        break;
      }

      case undefined: {
        // Default action - start the application
        setupLogging(logLevel as LevelName);
        logger = getAppLogger();
        logger.debug('Starting HAG application main function...');
        await runApplication(args.config, logLevel);
        break;
      }

      default: {
        console.error(`❌ Error: Unknown command '${command}'`);
        console.error('Run "hag --help" for usage information');
        Deno.exit(1);
      }
    }
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
