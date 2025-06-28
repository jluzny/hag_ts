/**
 * Main application entry point for HAG JavaScript variant.
 * 
 * CLI application using @cliffy/command with traditional dependency injection.
 */

import { Command } from '@cliffy/command';
import { createContainer, disposeContainer, ApplicationContainer } from './core/container.ts';
import { TYPES } from './core/types.ts';
import { HVACController } from './hvac/controller.ts';
import { ConfigLoader } from './config/loader.ts';
import { extractErrorDetails } from './core/exceptions.ts';

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
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await cleanup();
    Deno.exit(0);
  });

  Deno.addSignalListener('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await cleanup();
    Deno.exit(0);
  });

  // Handle unhandled errors
  globalThis.addEventListener('unhandledrejection', async (event) => {
    console.error('❌ Unhandled promise rejection:', event.reason);
    await cleanup();
    Deno.exit(1);
  });

  globalThis.addEventListener('error', async (event) => {
    console.error('❌ Unhandled error:', event.error);
    await cleanup();
    Deno.exit(1);
  });
}

/**
 * Run HAG application
 */
async function runApplication(configPath?: string): Promise<void> {
  try {
    // Create and initialize container
    container = await createContainer(configPath);
    
    // Get HVAC controller
    const controller = container.get<HVACController>(TYPES.HVACController);
    
    // Start the controller
    await controller.start();
    
    console.log('🏠 HAG HVAC automation is running...');
    console.log('📊 Press Ctrl+C to stop gracefully');
    
    // Keep the application running
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
  } catch (error) {
    const details = extractErrorDetails(error);
    console.error('❌ Application failed:', details.message);
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
      console.log(`✅ Configuration is valid: ${configPath}`);
      console.log(`   Log level: ${result.config.appOptions.logLevel}`);
      console.log(`   AI enabled: ${result.config.appOptions.useAi}`);
      console.log(`   Temperature sensor: ${result.config.hvacOptions.tempSensor}`);
      console.log(`   System mode: ${result.config.hvacOptions.systemMode}`);
      console.log(`   HVAC entities: ${result.config.hvacOptions.hvacEntities.length}`);
    } else {
      console.log(`❌ Configuration validation failed: ${configPath}`);
      if (result.errors) {
        for (const error of result.errors) {
          console.log(`   Error: ${error}`);
        }
      }
      Deno.exit(1);
    }
  } catch (error) {
    console.error('❌ Configuration validation error:', error);
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
    
    console.log('\n📊 HAG System Status');
    console.log('=' + '='.repeat(29));
    console.log(`Controller Running: ${status.controller.running}`);
    console.log(`HA Connected: ${status.controller.haConnected}`);
    console.log(`Temperature Sensor: ${status.controller.tempSensor}`);
    console.log(`System Mode: ${status.controller.systemMode}`);
    console.log(`AI Enabled: ${status.controller.aiEnabled}`);
    
    if (status.stateMachine) {
      console.log(`\nState Machine: ${status.stateMachine.currentState}`);
      if (status.stateMachine.hvacMode) {
        console.log(`HVAC Mode: ${status.stateMachine.hvacMode}`);
      }
      
      if (status.stateMachine.conditions) {
        const conditions = status.stateMachine.conditions;
        if (conditions.indoorTemp) {
          console.log(`Indoor Temp: ${conditions.indoorTemp}°C`);
        }
        if (conditions.outdoorTemp) {
          console.log(`Outdoor Temp: ${conditions.outdoorTemp}°C`);
        }
      }
    }
    
    if (status.aiAnalysis) {
      console.log(`\nAI Analysis:\n${status.aiAnalysis}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to get status:', error);
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
      console.log(`✅ Manual override successful: ${action}`);
      if (temperature) {
        console.log(`   Target temperature: ${temperature}°C`);
      }
    } else {
      console.log(`❌ Manual override failed: ${result.error}`);
      Deno.exit(1);
    }
    
    await controller.stop();
    
  } catch (error) {
    console.error('❌ Manual override error:', error);
    Deno.exit(1);
  }
}

/**
 * Show environment information
 */
function showEnvironment(): void {
  const envInfo = ConfigLoader.getEnvironmentInfo();
  
  console.log('\n🌍 Environment Information');
  console.log('=' + '='.repeat(26));
  console.log('Deno:', JSON.stringify(envInfo.deno, null, 2));
  console.log('Platform:', JSON.stringify(envInfo.platform, null, 2));
  console.log('Environment:', JSON.stringify(envInfo.environment, null, 2));
}

/**
 * Main CLI setup
 */
async function main(): Promise<void> {
  setupCleanup();
  
  const cli = new Command()
    .name('hag')
    .description('🏠 HAG - Home Assistant aGentic HVAC Automation')
    .version('1.0.0');

  // Main run command
  cli
    .option('-c, --config <file>', 'Configuration file path')
    .option('--log-level <level>', 'Log level (debug, info, warning, error)', { default: 'info' })
    .action(async (options) => {
      await runApplication(options.config);
    });

  // Validate configuration command
  cli
    .command('validate')
    .description('Validate configuration file')
    .option('-c, --config <file>', 'Configuration file path', { required: true })
    .action(async (options) => {
      await validateConfig(options.config);
    });

  // Status command
  cli
    .command('status')
    .description('Get system status')
    .option('-c, --config <file>', 'Configuration file path')
    .action(async (options) => {
      await getStatus(options.config);
    });

  // Manual override command
  cli
    .command('override <action>')
    .description('Manual HVAC override (heat, cool, off)')
    .option('-c, --config <file>', 'Configuration file path')
    .option('-t, --temperature <temp:number>', 'Target temperature')
    .action(async (options, action) => {
      await manualOverride(action, options.config, options.temperature);
    });

  // Environment info command
  cli
    .command('env')
    .description('Show environment information')
    .action(() => {
      showEnvironment();
    });

  // Parse and execute
  try {
    await cli.parse(Deno.args);
  } catch (error) {
    console.error('❌ CLI error:', error);
    await cleanup();
    Deno.exit(1);
  }
}

// Run the CLI
if (import.meta.main) {
  main().catch(async (error) => {
    console.error('❌ Application error:', error);
    await cleanup();
    Deno.exit(1);
  });
}