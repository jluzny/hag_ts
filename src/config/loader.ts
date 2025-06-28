/**
 * Configuration loader for HAG JavaScript variant.
 * 
 * Handles loading and validating configuration from YAML files and environment variables.
 */

import { parse } from 'yaml';
import { load as loadEnv } from '@std/dotenv';
import { join, dirname as _dirname, fromFileUrl as _fromFileUrl } from '@std/path';
import { getLogger } from '@std/log';
import { SettingsSchema, Settings } from './config.ts';
import { ConfigurationError } from '../core/exceptions.ts';

const logger = getLogger('ConfigLoader');

export class ConfigLoader {
  /**
   * Load configuration from file with environment variable overrides
   */
  static async loadSettings(configPath?: string): Promise<Settings> {
    try {
      // Load environment variables
      await this.loadEnvironment();

      // Determine config file path
      const resolvedPath = configPath || this.findConfigFile();
      logger.info(`Loading configuration from: ${resolvedPath}`);

      // Load and parse configuration file
      const rawConfig = await this.loadConfigFile(resolvedPath);
      
      // Merge with defaults
      const mergedConfig = await this.mergeWithDefaults(rawConfig);
      
      // Apply environment variable overrides
      const configWithEnv = this.applyEnvironmentOverrides(mergedConfig);
      
      // Validate configuration
      const validatedConfig = this.validateConfiguration(configWithEnv);
      
      logger.info('Configuration loaded and validated successfully');
      return validatedConfig;
      
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
        'config_file',
        configPath,
      );
    }
  }

  /**
   * Load environment variables from .env file
   */
  private static async loadEnvironment(): Promise<void> {
    try {
      await loadEnv({
        export: true,
      });
    } catch (error) {
      // .env file is optional, log warning but continue
      logger.warn(`Could not load .env file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find configuration file in standard locations
   */
  private static findConfigFile(): string {
    const possiblePaths = [
      Deno.env.get('HAG_CONFIG_FILE'),
      'config/hvac_config.yaml',
      'hvac_config.yaml',
      join(Deno.env.get('HOME') || '~', '.config', 'hag', 'hvac_config.yaml'),
      '/etc/hag/hvac_config.yaml',
    ].filter(Boolean) as string[];

    for (const path of possiblePaths) {
      try {
        const stat = Deno.statSync(path);
        if (stat.isFile) {
          return path;
        }
      } catch {
        // File doesn't exist, continue
      }
    }

    // Default to expected location
    return 'config/hvac_config.yaml';
  }

  /**
   * Load and parse YAML configuration file
   */
  private static async loadConfigFile(configPath: string): Promise<unknown> {
    try {
      const configText = await Deno.readTextFile(configPath);
      const resolvedText = this.resolveEnvironmentVariables(configText);
      return parse(resolvedText);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ConfigurationError(
          `Configuration file not found: ${configPath}`,
          'config_file',
          configPath,
        );
      }
      throw new ConfigurationError(
        `Failed to read configuration file: ${error instanceof Error ? error.message : String(error)}`,
        'config_file',
        configPath,
      );
    }
  }

  /**
   * Resolve environment variable placeholders in configuration text
   */
  private static resolveEnvironmentVariables(configText: string): string {
    return configText.replace(/\$\{([^}]+)\}/g, (match, envVarName) => {
      const envValue = Deno.env.get(envVarName);
      if (envValue === undefined) {
        logger.warn(`Environment variable ${envVarName} not found, keeping placeholder ${match}`);
        return match;
      }
      logger.debug(`Resolved ${match} to environment variable value`);
      return envValue;
    });
  }

  /**
   * Load default configuration from YAML file
   */
  private static async loadDefaultConfig(): Promise<unknown> {
    try {
      // Try to load config.yaml as the default
      const defaultConfigPath = 'config.yaml';
      return await this.loadConfigFile(defaultConfigPath);
    } catch (error) {
      // If config.yaml doesn't exist, use basic minimal defaults
      logger.warn('No default config.yaml found, using minimal defaults');
      return {
        appOptions: {
          logLevel: 'info',
          useAi: false,
          aiModel: 'gpt-3.5-turbo',
          aiTemperature: 0.1,
        },
        hassOptions: {
          wsUrl: 'ws://localhost:8123/api/websocket',
          restUrl: 'http://localhost:8123/api',
          token: 'your_long_lived_access_token_here',
          maxRetries: 5,
          retryDelayMs: 1000,
          stateCheckInterval: 300000,
        },
        hvacOptions: {
          tempSensor: 'sensor.indoor_temperature',
          outdoorSensor: 'sensor.openweathermap_temperature',
          systemMode: 'auto',
          hvacEntities: [],
          heating: {
            temperature: 21.0,
            presetMode: 'comfort',
            temperatureThresholds: {
              indoorMin: 18.0,
              indoorMax: 28.0,
              outdoorMin: -20.0,
              outdoorMax: 40.0,
            },
          },
          cooling: {
            temperature: 24.0,
            presetMode: 'eco',
            temperatureThresholds: {
              indoorMin: 18.0,
              indoorMax: 28.0,
              outdoorMin: -20.0,
              outdoorMax: 40.0,
            },
          },
          activeHours: {
            start: 8,
            startWeekday: 7,
            end: 22,
          },
        },
      };
    }
  }

  /**
   * Merge configuration with default values from YAML file
   */
  private static async mergeWithDefaults(config: unknown): Promise<unknown> {
    const defaultConfig = await this.loadDefaultConfig();
    
    if (typeof config !== 'object' || config === null) {
      return defaultConfig;
    }

    const configObj = config as Record<string, unknown>;
    const defaultObj = defaultConfig as Record<string, unknown>;
    
    return {
      appOptions: {
        ...(defaultObj.appOptions as Record<string, unknown> || {}),
        ...(configObj.appOptions as Record<string, unknown> || {}),
      },
      hassOptions: {
        ...(defaultObj.hassOptions as Record<string, unknown> || {}),
        ...(configObj.hassOptions as Record<string, unknown> || {}),
      },
      hvacOptions: {
        ...(defaultObj.hvacOptions as Record<string, unknown> || {}),
        ...(configObj.hvacOptions as Record<string, unknown> || {}),
        heating: {
          ...((defaultObj.hvacOptions as Record<string, unknown>)?.heating as Record<string, unknown> || {}),
          ...((configObj.hvacOptions as Record<string, unknown>)?.heating as Record<string, unknown> || {}),
        },
        cooling: {
          ...((defaultObj.hvacOptions as Record<string, unknown>)?.cooling as Record<string, unknown> || {}),
          ...((configObj.hvacOptions as Record<string, unknown>)?.cooling as Record<string, unknown> || {}),
        },
      },
    };
  }

  /**
   * Apply environment variable overrides
   */
  private static applyEnvironmentOverrides(config: unknown): unknown {
    const configObj = config as Record<string, unknown>;
    
    // Home Assistant options
    const hassOptions = configObj.hassOptions as Record<string, unknown> || {};
    if (Deno.env.get('HASS_WS_URL')) hassOptions.wsUrl = Deno.env.get('HASS_WS_URL');
    if (Deno.env.get('HASS_REST_URL')) hassOptions.restUrl = Deno.env.get('HASS_REST_URL');
    if (Deno.env.get('HASS_TOKEN')) hassOptions.token = Deno.env.get('HASS_TOKEN');
    if (Deno.env.get('HASS_MAX_RETRIES')) {
      hassOptions.maxRetries = parseInt(Deno.env.get('HASS_MAX_RETRIES')!, 10);
    }

    // Application options
    const appOptions = configObj.appOptions as Record<string, unknown> || {};
    if (Deno.env.get('HAG_LOG_LEVEL')) appOptions.logLevel = Deno.env.get('HAG_LOG_LEVEL');
    if (Deno.env.get('HAG_USE_AI')) appOptions.useAi = Deno.env.get('HAG_USE_AI') === 'true';
    if (Deno.env.get('HAG_AI_MODEL')) appOptions.aiModel = Deno.env.get('HAG_AI_MODEL');
    if (Deno.env.get('OPENAI_API_KEY')) {
      // Ensure OpenAI key is available for AI features
      logger.info('OpenAI API key found in environment');
    }

    // HVAC options
    const hvacOptions = configObj.hvacOptions as Record<string, unknown> || {};
    if (Deno.env.get('HAG_TEMP_SENSOR')) hvacOptions.tempSensor = Deno.env.get('HAG_TEMP_SENSOR');
    if (Deno.env.get('HAG_OUTDOOR_SENSOR')) hvacOptions.outdoorSensor = Deno.env.get('HAG_OUTDOOR_SENSOR');
    if (Deno.env.get('HAG_SYSTEM_MODE')) hvacOptions.systemMode = Deno.env.get('HAG_SYSTEM_MODE');

    return {
      ...configObj,
      hassOptions,
      appOptions,
      hvacOptions,
    };
  }

  /**
   * Validate configuration against schema
   */
  private static validateConfiguration(config: unknown): Settings {
    try {
      return SettingsSchema.parse(config);
    } catch (error) {
      if (error && typeof error === 'object' && 'issues' in error) {
        const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
        const errorMessages = issues.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw new ConfigurationError(
          `Configuration validation failed: ${errorMessages}`,
          'validation',
          config,
        );
      }
      
      throw new ConfigurationError(
        `Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`,
        'validation',
        config,
      );
    }
  }

  /**
   * Validate configuration file without loading full application
   */
  static async validateConfigFile(configPath: string): Promise<{
    valid: boolean;
    errors?: string[];
    config?: Settings;
  }> {
    try {
      const config = await this.loadSettings(configPath);
      return { valid: true, config };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { 
        valid: false, 
        errors: [errorMessage],
      };
    }
  }

  /**
   * Get current environment information
   */
  static getEnvironmentInfo(): Record<string, unknown> {
    return {
      deno: {
        version: Deno.version.deno,
        typescript: Deno.version.typescript,
        v8: Deno.version.v8,
      },
      platform: {
        os: Deno.build.os,
        arch: Deno.build.arch,
      },
      environment: {
        hasOpenAI: !!Deno.env.get('OPENAI_API_KEY'),
        hasLangSmith: !!Deno.env.get('LANGCHAIN_API_KEY'),
        configFile: Deno.env.get('HAG_CONFIG_FILE'),
      },
    };
  }
}