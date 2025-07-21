/**
 * Configuration loader for HAG JavaScript variant.
 *
 * Handles loading and validating configuration from YAML files and environment variables.
 */

import { parse } from "yaml";
import { config as loadEnv } from "dotenv";
import { join } from "path";
import { readFile, stat } from "fs/promises";
import { statSync } from "fs";
import { homedir, platform, arch } from "os";
import { Settings, SettingsSchema } from "./config.ts";
import {
  ConfigurationError,
  toError,
  getErrorMessage,
} from "../core/exceptions.ts";
import { LoggerService } from "../core/logging.ts";

const logger = new LoggerService("ConfigLoader");

export class ConfigLoader {
  /**
   * Helper method to check if file exists
   */
  private static async fileExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isFile();
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
      logger.info("🚀 Starting configuration loading process", {
        providedPath: configPath,
        timestamp: new Date().toISOString(),
      });

      // Load environment variables
      logger.debug("🌍 Loading environment variables");
      await this.loadEnvironment();
      logger.debug("✅ Environment variables loaded");

      // Determine config file path
      const resolvedPath = configPath || this.findConfigFile();
      logger.info("📄 Configuration file path resolved", {
        resolvedPath,
        wasProvided: !!configPath,
        fileExists: await this.fileExists(resolvedPath),
      });

      // Load and parse configuration file
      logger.debug("📋 Loading configuration file");
      const rawConfig = await this.loadConfigFile(resolvedPath);
      logger.info("✅ Configuration file loaded and parsed", {
        hasContent: !!rawConfig,
        configType: typeof rawConfig,
        topLevelKeys:
          rawConfig && typeof rawConfig === "object"
            ? Object.keys(rawConfig as Record<string, unknown>)
            : [],
      });

      // Apply environment variable overrides
      logger.debug("🌍 Applying environment variable overrides");
      const configWithEnv = this.applyEnvironmentOverrides(rawConfig);
      logger.debug("✅ Environment overrides applied");

      // Validate configuration
      logger.debug("⚙️ Validating configuration schema");
      const validatedConfig = this.validateConfiguration(configWithEnv);

      const loadTime = Date.now() - loadStart;

      logger.info("✅ Configuration loaded and validated successfully", {
        configPath: resolvedPath,
        loadTimeMs: loadTime,
        systemMode: validatedConfig.hvacOptions.systemMode,
        aiEnabled: validatedConfig.appOptions.useAi,
        hvacEntities: validatedConfig.hvacOptions.hvacEntities.length,
        logLevel: validatedConfig.appOptions.logLevel,
        hasOpenaiKey: !!validatedConfig.appOptions.openaiApiKey,
      });

      return validatedConfig;
    } catch (error) {
      const loadTime = Date.now() - loadStart;

      logger.error("❌ Configuration loading failed", toError(error), {
        configPath,
        loadTimeMs: loadTime,
      });

      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError(
        `Failed to load configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "config_file",
        configPath,
      );
    }
  }

  /**
   * Load environment variables from .env file
   */
  private static async loadEnvironment(): Promise<void> {
    try {
      logger.debug("📄 Loading .env file");
      loadEnv();

      const relevantEnvVars = [
        "HASS_WS_URL",
        "HASS_REST_URL",
        "HASS_TOKEN",
        "HAG_LOG_LEVEL",
        "HAG_USE_AI",
        "OPENAI_API_KEY",
        "HAG_TEMP_SENSOR",
        "HAG_OUTDOOR_SENSOR",
        "HAG_SYSTEM_MODE",
        "HAG_CONFIG_FILE",
      ];

      const foundVars = relevantEnvVars.filter((key) => process.env[key]);

      logger.info("✅ Environment file loaded", {
        foundVariables: foundVars.length,
        relevantVars: foundVars,
        hasHassConfig: !!(process.env.HASS_WS_URL || process.env.HASS_TOKEN),
        hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      });
    } catch (error) {
      // .env file is optional, log warning but continue
      logger.warning("⚠️ Could not load .env file (optional)", {
        error: error instanceof Error ? error.message : String(error),
        reason: "file_not_found_or_invalid",
      });
    }
  }

  /**
   * Find configuration file in standard locations
   */
  private static findConfigFile(env?: string): string {
    const possiblePaths = [
      process.env.HAG_CONFIG_FILE,
      env ? `config/hvac_config_${env}.yaml` : undefined,
      "config/hvac_config.yaml",
      "hvac_config.yaml",
      join(homedir(), ".config", "hag", "hvac_config.yaml"),
      "/etc/hag/hvac_config.yaml",
    ].filter(Boolean) as string[];

    logger.debug("🔍 Searching for configuration file", {
      searchPaths: possiblePaths,
      envConfigFile: process.env.HAG_CONFIG_FILE,
      homeDir: homedir(),
    });

    for (const path of possiblePaths) {
      try {
        const stats = statSync(path);
        if (stats.isFile()) {
          logger.info("✅ Configuration file found", {
            path,
            fileSize: stats.size,
            modified: stats.mtime?.toISOString(),
          });
          return path;
        }
      } catch (error) {
        logger.debug("❌ Configuration file not found", {
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Default to expected location
    const defaultPath = "config/hvac_config.yaml";
    logger.warning("⚠️ No configuration file found, using default path", {
      defaultPath,
      searchedPaths: possiblePaths,
      note: "File may not exist at default location",
    });

    return defaultPath;
  }

  /**
   * Load and parse YAML configuration file
   */
  private static async loadConfigFile(configPath: string): Promise<unknown> {
    const readStart = Date.now();

    try {
      logger.debug("📄 Reading configuration file", {
        path: configPath,
      });

      const configText = await readFile(configPath, "utf-8");

      logger.debug("✅ Configuration file read", {
        path: configPath,
        contentLength: configText.length,
        hasEnvironmentVariables: configText.includes("${"),
      });

      const resolvedText = this.resolveEnvironmentVariables(configText);

      logger.debug("🔄 Parsing YAML configuration");
      const parsed = parse(resolvedText);

      const readTime = Date.now() - readStart;

      logger.info("✅ Configuration file parsed successfully", {
        path: configPath,
        readTimeMs: readTime,
        configType: typeof parsed,
        hasContent: !!parsed,
        topLevelKeys:
          parsed && typeof parsed === "object"
            ? Object.keys(parsed as Record<string, unknown>)
            : [],
      });

      return parsed;
    } catch (error) {
      const readTime = Date.now() - readStart;

      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        logger.error(
          "❌ Configuration file not found",
          toError(error, "File not found"),
          {
            path: configPath,
            readTimeMs: readTime,
          },
        );

        throw new ConfigurationError(
          `Configuration file not found: ${configPath}`,
          "config_file",
          configPath,
        );
      }

      logger.error(
        "❌ Failed to read/parse configuration file",
        toError(error),
        {
          path: configPath,
          readTimeMs: readTime,
        },
      );

      throw new ConfigurationError(
        `Failed to read configuration file: ${getErrorMessage(error)}`,
        "config_file",
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

    const resolvedText = configText.replace(
      envVarPattern,
      (match, envVarName) => {
        foundVars.push(envVarName);
        const envValue = process.env[envVarName];

        if (envValue === undefined) {
          unresolvedVars.push(envVarName);
          logger.warning(`⚠️ Environment variable not found: ${envVarName}`, {
            placeholder: match,
            behavior: "keeping_placeholder",
          });
          return match;
        }

        resolvedVars[envVarName] = envValue;
        logger.debug(`✅ Resolved environment variable: ${envVarName}`, {
          placeholder: match,
          hasValue: true,
        });

        return envValue;
      },
    );

    if (foundVars.length > 0) {
      logger.info("🌍 Environment variable resolution completed", {
        totalVariables: foundVars.length,
        resolvedCount: Object.keys(resolvedVars).length,
        unresolvedCount: unresolvedVars.length,
        resolvedVars: Object.keys(resolvedVars),
        unresolvedVars,
      });
    } else {
      logger.debug("🌍 No environment variables found in configuration");
    }

    return resolvedText;
  }

  /**
   * Apply environment variable overrides
   */
  private static applyEnvironmentOverrides(config: unknown): unknown {
    const configObj = config as Record<string, unknown>;

    logger.debug("🌍 Applying environment variable overrides");

    // Home Assistant options
    const hassOptions = {
      ...((configObj.hassOptions as Record<string, unknown>) || {}),
    };
    const hassOverrides: string[] = [];

    if (process.env.HASS_WS_URL) {
      hassOptions.wsUrl = process.env.HASS_WS_URL;
      hassOverrides.push("wsUrl");
    }
    if (process.env.HASS_REST_URL) {
      hassOptions.restUrl = process.env.HASS_REST_URL;
      hassOverrides.push("restUrl");
    }
    if (process.env.HASS_TOKEN) {
      hassOptions.token = process.env.HASS_TOKEN;
      hassOverrides.push("token");
    }
    if (process.env.HASS_MAX_RETRIES) {
      hassOptions.maxRetries = parseInt(process.env.HASS_MAX_RETRIES, 10);
      hassOverrides.push("maxRetries");
    }

    // Application options
    const appOptions = {
      ...((configObj.appOptions as Record<string, unknown>) || {}),
    };
    const appOverrides: string[] = [];

    if (process.env.HAG_LOG_LEVEL) {
      appOptions.logLevel = process.env.HAG_LOG_LEVEL;
      appOverrides.push("logLevel");
    }
    if (process.env.HAG_USE_AI) {
      appOptions.useAi = process.env.HAG_USE_AI === "true";
      appOverrides.push("useAi");
    }
    if (process.env.HAG_AI_MODEL) {
      appOptions.aiModel = process.env.HAG_AI_MODEL;
      appOverrides.push("aiModel");
    }
    if (process.env.OPENAI_API_KEY) {
      appOptions.openaiApiKey = process.env.OPENAI_API_KEY;
      appOverrides.push("openaiApiKey");
      logger.debug("✅ OpenAI API key found in environment");
    }

    // HVAC options
    const hvacOptions = {
      ...((configObj.hvacOptions as Record<string, unknown>) || {}),
    };
    const hvacOverrides: string[] = [];

    if (process.env.HAG_TEMP_SENSOR) {
      hvacOptions.tempSensor = process.env.HAG_TEMP_SENSOR;
      hvacOverrides.push("tempSensor");
    }
    if (process.env.HAG_OUTDOOR_SENSOR) {
      hvacOptions.outdoorSensor = process.env.HAG_OUTDOOR_SENSOR;
      hvacOverrides.push("outdoorSensor");
    }
    if (process.env.HAG_SYSTEM_MODE) {
      hvacOptions.systemMode = process.env.HAG_SYSTEM_MODE;
      hvacOverrides.push("systemMode");
    }

    const totalOverrides =
      hassOverrides.length + appOverrides.length + hvacOverrides.length;

    logger.info("✅ Environment overrides applied", {
      totalOverrides,
      hassOverrides,
      appOverrides,
      hvacOverrides,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      hasHassToken: !!process.env.HASS_TOKEN,
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
      logger.debug("⚙️ Starting configuration validation");

      const validatedConfig = SettingsSchema.parse(config);

      const validationTime = Date.now() - validationStart;

      logger.info("✅ Configuration validation successful", {
        validationTimeMs: validationTime,
        systemMode: validatedConfig.hvacOptions.systemMode,
        aiEnabled: validatedConfig.appOptions.useAi,
        hvacEntitiesCount: validatedConfig.hvacOptions.hvacEntities.length,
        hasRequiredSensors: !!(
          validatedConfig.hvacOptions.tempSensor &&
          validatedConfig.hvacOptions.outdoorSensor
        ),
        hasHassConnection: !!(
          validatedConfig.hassOptions.wsUrl && validatedConfig.hassOptions.token
        ),
        logLevel: validatedConfig.appOptions.logLevel,
      });

      return validatedConfig;
    } catch (error) {
      const validationTime = Date.now() - validationStart;

      if (error && typeof error === "object" && "issues" in error) {
        const issues = (
          error as {
            issues: Array<{
              path: (string | number)[];
              message: string;
              code: string;
            }>;
          }
        ).issues;

        const errorDetails = issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        }));

        const errorMessages = errorDetails
          .map((detail) => `${detail.path}: ${detail.message}`)
          .join(", ");

        logger.error(
          "❌ Configuration validation failed with schema errors",
          new Error(`Validation failed: ${errorMessages}`),
          {
            validationTimeMs: validationTime,
            errorCount: issues.length,
            errors: errorDetails,
          },
        );

        throw new ConfigurationError(
          `Configuration validation failed: ${errorMessages}`,
          "validation",
          config,
        );
      }

      logger.error(
        "❌ Configuration validation failed with unknown error",
        toError(error),
        {
          validationTimeMs: validationTime,
          configType: typeof config,
        },
      );

      throw new ConfigurationError(
        `Configuration validation failed: ${getErrorMessage(error)}`,
        "validation",
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
      logger.info("⚙️ Validating configuration file", {
        configPath,
        timestamp: new Date().toISOString(),
      });

      const config = await this.loadSettings(configPath);

      const validationTime = Date.now() - validationStart;

      logger.info("✅ Configuration file validation successful", {
        configPath,
        validationTimeMs: validationTime,
        systemMode: config.hvacOptions.systemMode,
        aiEnabled: config.appOptions.useAi,
        hvacEntities: config.hvacOptions.hvacEntities.length,
      });

      return { valid: true, config };
    } catch (error) {
      const validationTime = Date.now() - validationStart;
      const errorMessage = getErrorMessage(error);

      logger.error("❌ Configuration file validation failed", toError(error), {
        configPath,
        validationTimeMs: validationTime,
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
      bun: {
        version: process.versions.bun || "N/A",
        node: process.versions.node,
        v8: process.versions.v8,
      },
      platform: {
        os: platform(),
        arch: arch(),
      },
      environment: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasLangSmith: !!process.env.LANGCHAIN_API_KEY,
        configFile: process.env.HAG_CONFIG_FILE,
      },
    };
  }
}
