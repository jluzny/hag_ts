/**
 * Configuration loader for HAG JavaScript variant.
 * 
 * Handles loading and validating configuration from YAML files and environment variables.
 */

import { parse } from 'yaml';
import { load as loadEnv } from '@std/dotenv';
import { join, dirname, fromFileUrl } from '@std/path';
import { getLogger } from '@std/log';
import { SettingsSchema, Settings, defaultSettings } from './settings.ts';
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
      const mergedConfig = this.mergeWithDefaults(rawConfig);
      
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
      return parse(configText);
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
   * Merge configuration with default values
   */
  private static mergeWithDefaults(config: unknown): unknown {
    if (typeof config !== 'object' || config === null) {
      return { ...defaultSettings };
    }

    const configObj = config as Record<string, unknown>;
    
    return {
      appOptions: {
        ...defaultSettings.appOptions,
        ...(configObj.appOptions as Record<string, unknown> || {}),
      },
      hassOptions: {
        ...defaultSettings.hassOptions,
        ...(configObj.hassOptions as Record<string, unknown> || {}),
      },
      hvacOptions: {
        ...defaultSettings.hvacOptions,
        ...(configObj.hvacOptions as Record<string, unknown> || {}),
        heating: {
          ...defaultSettings.hvacOptions?.heating,
          ...(configObj.hvacOptions as Record<string, unknown>)?.heating as Record<string, unknown> || {},
        },
        cooling: {
          ...defaultSettings.hvacOptions?.cooling,
          ...(configObj.hvacOptions as Record<string, unknown>)?.cooling as Record<string, unknown> || {},
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