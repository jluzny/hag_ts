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
import { LoggerService } from '../core/logger.ts';

const logger = new LoggerService('ConfigLoader');

export class ConfigLoader {
  /**
   * Helper method to check if file exists
   */
  private static async fileExists(path: string): Promise<boolean> {
    try {
      const stat = await Deno.stat(path);
      return stat.isFile;
    } catch {
      return false;
    }
  }
  /**
   * Load configuration from file with environment variable overrides
   */
  static async loadSettings(configPath?: string): Promise<Settings> {
    const loadStart = Date.now();
    
    try {
      logger.info('🚀 Starting configuration loading process', {
        providedPath: configPath,
        timestamp: new Date().toISOString()
      });
      
      // Load environment variables
      logger.debug('🌍 Loading environment variables');
      await this.loadEnvironment();
      logger.debug('✅ Environment variables loaded');

      // Determine config file path
      const resolvedPath = configPath || this.findConfigFile();
      logger.info('📄 Configuration file path resolved', {
        resolvedPath,
        wasProvided: !!configPath,
        fileExists: await this.fileExists(resolvedPath)
      });

      // Load and parse configuration file
      logger.debug('📋 Loading configuration file');
      const rawConfig = await this.loadConfigFile(resolvedPath);
      logger.info('✅ Configuration file loaded and parsed', {
        hasContent: !!rawConfig,
        configType: typeof rawConfig,
        topLevelKeys: rawConfig && typeof rawConfig === 'object' ? Object.keys(rawConfig as Record<string, unknown>) : []
      });
      
      // Merge with defaults
      logger.debug('🔄 Merging with default configuration');
      const mergedConfig = await this.mergeWithDefaults(rawConfig);
      logger.debug('✅ Configuration merged with defaults');
      
      // Apply environment variable overrides
      logger.debug('🌍 Applying environment variable overrides');
      const configWithEnv = this.applyEnvironmentOverrides(mergedConfig);
      logger.debug('✅ Environment overrides applied');
      
      // Validate configuration
      logger.debug('⚙️ Validating configuration schema');
      const validatedConfig = this.validateConfiguration(configWithEnv);
      
      const loadTime = Date.now() - loadStart;
      
      logger.info('✅ Configuration loaded and validated successfully', {
        configPath: resolvedPath,
        loadTimeMs: loadTime,
        systemMode: validatedConfig.hvacOptions.systemMode,
        aiEnabled: validatedConfig.appOptions.useAi,
        hvacEntities: validatedConfig.hvacOptions.hvacEntities.length,
        logLevel: validatedConfig.appOptions.logLevel,
        hasOpenaiKey: !!validatedConfig.appOptions.openaiApiKey
      });
      
      return validatedConfig;
      
    } catch (error) {
      const loadTime = Date.now() - loadStart;
      
      logger.error('❌ Configuration loading failed', {
        error,
        configPath,
        loadTimeMs: loadTime,
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
      
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
      logger.debug('📄 Loading .env file');
      await loadEnv({
        export: true,
      });
      
      const relevantEnvVars = [
        'HASS_WS_URL', 'HASS_REST_URL', 'HASS_TOKEN',
        'HAG_LOG_LEVEL', 'HAG_USE_AI', 'OPENAI_API_KEY',
        'HAG_TEMP_SENSOR', 'HAG_OUTDOOR_SENSOR', 'HAG_SYSTEM_MODE',
        'HAG_CONFIG_FILE'
      ];
      
      const foundVars = relevantEnvVars.filter(key => Deno.env.get(key));
      
      logger.info('✅ Environment file loaded', {
        foundVariables: foundVars.length,
        relevantVars: foundVars,
        hasHassConfig: !!(Deno.env.get('HASS_WS_URL') || Deno.env.get('HASS_TOKEN')),
        hasOpenaiKey: !!Deno.env.get('OPENAI_API_KEY')
      });
      
    } catch (error) {
      // .env file is optional, log warning but continue
      logger.warning('⚠️ Could not load .env file (optional)', {
        error: error instanceof Error ? error.message : String(error),
        reason: 'file_not_found_or_invalid'
      });
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

    logger.debug('🔍 Searching for configuration file', {
      searchPaths: possiblePaths,
      envConfigFile: Deno.env.get('HAG_CONFIG_FILE'),
      homeDir: Deno.env.get('HOME')
    });

    for (const path of possiblePaths) {
      try {
        const stat = Deno.statSync(path);
        if (stat.isFile) {
          logger.info('✅ Configuration file found', {
            path,
            fileSize: stat.size,
            modified: stat.mtime?.toISOString()
          });
          return path;
        }
      } catch (error) {
        logger.debug('❌ Configuration file not found', {
          path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Default to expected location
    const defaultPath = 'config/hvac_config.yaml';
    logger.warning('⚠️ No configuration file found, using default path', {
      defaultPath,
      searchedPaths: possiblePaths,
      note: 'File may not exist at default location'
    });
    
    return defaultPath;
  }

  /**
   * Load and parse YAML configuration file
   */
  private static async loadConfigFile(configPath: string): Promise<unknown> {
    const readStart = Date.now();
    
    try {
      logger.debug('📄 Reading configuration file', {
        path: configPath
      });
      
      const configText = await Deno.readTextFile(configPath);
      
      logger.debug('✅ Configuration file read', {
        path: configPath,
        contentLength: configText.length,
        hasEnvironmentVariables: configText.includes('${')
      });
      
      const resolvedText = this.resolveEnvironmentVariables(configText);
      
      logger.debug('🔄 Parsing YAML configuration');
      const parsed = parse(resolvedText);
      
      const readTime = Date.now() - readStart;
      
      logger.info('✅ Configuration file parsed successfully', {
        path: configPath,
        readTimeMs: readTime,
        configType: typeof parsed,
        hasContent: !!parsed,
        topLevelKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>) : []
      });
      
      return parsed;
      
    } catch (error) {
      const readTime = Date.now() - readStart;
      
      if (error instanceof Deno.errors.NotFound) {
        logger.error('❌ Configuration file not found', {
          path: configPath,
          readTimeMs: readTime,
          errorType: 'file_not_found'
        });
        
        throw new ConfigurationError(
          `Configuration file not found: ${configPath}`,
          'config_file',
          configPath,
        );
      }
      
      logger.error('❌ Failed to read/parse configuration file', {
        path: configPath,
        readTimeMs: readTime,
        error,
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
      
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
    const envVarPattern = /\$\{([^}]+)\}/g;
    const foundVars: string[] = [];
    const resolvedVars: Record<string, string> = {};
    const unresolvedVars: string[] = [];
    
    const resolvedText = configText.replace(envVarPattern, (match, envVarName) => {
      foundVars.push(envVarName);
      const envValue = Deno.env.get(envVarName);
      
      if (envValue === undefined) {
        unresolvedVars.push(envVarName);
        logger.warning(`⚠️ Environment variable not found: ${envVarName}`, {
          placeholder: match,
          behavior: 'keeping_placeholder'
        });
        return match;
      }
      
      resolvedVars[envVarName] = envValue;
      logger.debug(`✅ Resolved environment variable: ${envVarName}`, {
        placeholder: match,
        hasValue: true
      });
      
      return envValue;
    });
    
    if (foundVars.length > 0) {
      logger.info('🌍 Environment variable resolution completed', {
        totalVariables: foundVars.length,
        resolvedCount: Object.keys(resolvedVars).length,
        unresolvedCount: unresolvedVars.length,
        resolvedVars: Object.keys(resolvedVars),
        unresolvedVars
      });
    } else {
      logger.debug('🌍 No environment variables found in configuration');
    }
    
    return resolvedText;
  }

  /**
   * Load default configuration from YAML file
   */
  private static async loadDefaultConfig(): Promise<unknown> {
    try {
      // Try to load config.yaml as the default
      const defaultConfigPath = 'config.yaml';
      return await this.loadConfigFile(defaultConfigPath);
    } catch (_error) {
      // If config.yaml doesn't exist, use basic minimal defaults
      logger.warning('No default config.yaml found, using minimal defaults');
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
    const overrides: Record<string, unknown> = {};
    
    logger.debug('🌍 Applying environment variable overrides');
    
    // Home Assistant options
    const hassOptions = { ...(configObj.hassOptions as Record<string, unknown> || {}) };
    const hassOverrides: string[] = [];
    
    if (Deno.env.get('HASS_WS_URL')) {
      hassOptions.wsUrl = Deno.env.get('HASS_WS_URL');
      hassOverrides.push('wsUrl');
    }
    if (Deno.env.get('HASS_REST_URL')) {
      hassOptions.restUrl = Deno.env.get('HASS_REST_URL');
      hassOverrides.push('restUrl');
    }
    if (Deno.env.get('HASS_TOKEN')) {
      hassOptions.token = Deno.env.get('HASS_TOKEN');
      hassOverrides.push('token');
    }
    if (Deno.env.get('HASS_MAX_RETRIES')) {
      hassOptions.maxRetries = parseInt(Deno.env.get('HASS_MAX_RETRIES')!, 10);
      hassOverrides.push('maxRetries');
    }

    // Application options
    const appOptions = { ...(configObj.appOptions as Record<string, unknown> || {}) };
    const appOverrides: string[] = [];
    
    if (Deno.env.get('HAG_LOG_LEVEL')) {
      appOptions.logLevel = Deno.env.get('HAG_LOG_LEVEL');
      appOverrides.push('logLevel');
    }
    if (Deno.env.get('HAG_USE_AI')) {
      appOptions.useAi = Deno.env.get('HAG_USE_AI') === 'true';
      appOverrides.push('useAi');
    }
    if (Deno.env.get('HAG_AI_MODEL')) {
      appOptions.aiModel = Deno.env.get('HAG_AI_MODEL');
      appOverrides.push('aiModel');
    }
    if (Deno.env.get('OPENAI_API_KEY')) {
      appOptions.openaiApiKey = Deno.env.get('OPENAI_API_KEY');
      appOverrides.push('openaiApiKey');
      logger.debug('✅ OpenAI API key found in environment');
    }

    // HVAC options
    const hvacOptions = { ...(configObj.hvacOptions as Record<string, unknown> || {}) };
    const hvacOverrides: string[] = [];
    
    if (Deno.env.get('HAG_TEMP_SENSOR')) {
      hvacOptions.tempSensor = Deno.env.get('HAG_TEMP_SENSOR');
      hvacOverrides.push('tempSensor');
    }
    if (Deno.env.get('HAG_OUTDOOR_SENSOR')) {
      hvacOptions.outdoorSensor = Deno.env.get('HAG_OUTDOOR_SENSOR');
      hvacOverrides.push('outdoorSensor');
    }
    if (Deno.env.get('HAG_SYSTEM_MODE')) {
      hvacOptions.systemMode = Deno.env.get('HAG_SYSTEM_MODE');
      hvacOverrides.push('systemMode');
    }
    
    const totalOverrides = hassOverrides.length + appOverrides.length + hvacOverrides.length;
    
    logger.info('✅ Environment overrides applied', {
      totalOverrides,
      hassOverrides,
      appOverrides,
      hvacOverrides,
      hasOpenaiKey: !!Deno.env.get('OPENAI_API_KEY'),
      hasHassToken: !!Deno.env.get('HASS_TOKEN')
    });

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
    const validationStart = Date.now();
    
    try {
      logger.debug('⚙️ Starting configuration validation');
      
      const validatedConfig = SettingsSchema.parse(config);
      
      const validationTime = Date.now() - validationStart;
      
      logger.info('✅ Configuration validation successful', {
        validationTimeMs: validationTime,
        systemMode: validatedConfig.hvacOptions.systemMode,
        aiEnabled: validatedConfig.appOptions.useAi,
        hvacEntitiesCount: validatedConfig.hvacOptions.hvacEntities.length,
        hasRequiredSensors: !!(validatedConfig.hvacOptions.tempSensor && validatedConfig.hvacOptions.outdoorSensor),
        hasHassConnection: !!(validatedConfig.hassOptions.wsUrl && validatedConfig.hassOptions.token),
        logLevel: validatedConfig.appOptions.logLevel
      });
      
      return validatedConfig;
      
    } catch (error) {
      const validationTime = Date.now() - validationStart;
      
      if (error && typeof error === 'object' && 'issues' in error) {
        const issues = (error as { issues: Array<{ path: (string | number)[]; message: string; code: string }> }).issues;
        
        const errorDetails = issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        }));
        
        const errorMessages = errorDetails.map(detail => 
          `${detail.path}: ${detail.message}`
        ).join(', ');
        
        logger.error('❌ Configuration validation failed with schema errors', {
          validationTimeMs: validationTime,
          errorCount: issues.length,
          errors: errorDetails,
          configKeys: config && typeof config === 'object' ? Object.keys(config as Record<string, unknown>) : []
        });
        
        throw new ConfigurationError(
          `Configuration validation failed: ${errorMessages}`,
          'validation',
          config,
        );
      }
      
      logger.error('❌ Configuration validation failed with unknown error', {
        validationTimeMs: validationTime,
        error,
        errorType: error instanceof Error ? error.name : 'Unknown',
        configType: typeof config
      });
      
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
    const validationStart = Date.now();
    
    try {
      logger.info('⚙️ Validating configuration file', {
        configPath,
        timestamp: new Date().toISOString()
      });
      
      const config = await this.loadSettings(configPath);
      
      const validationTime = Date.now() - validationStart;
      
      logger.info('✅ Configuration file validation successful', {
        configPath,
        validationTimeMs: validationTime,
        systemMode: config.hvacOptions.systemMode,
        aiEnabled: config.appOptions.useAi,
        hvacEntities: config.hvacOptions.hvacEntities.length
      });
      
      return { valid: true, config };
      
    } catch (error) {
      const validationTime = Date.now() - validationStart;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('❌ Configuration file validation failed', {
        configPath,
        validationTimeMs: validationTime,
        error,
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
      
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