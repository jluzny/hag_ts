/**
 * Minimalistic configuration system for common and module-specific configurations
 */

import { ZodSchema, ZodError } from 'zod';
import { LoggerService } from './logger.ts';

/**
 * Configuration validation result
 */
export interface ConfigValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Configuration manager for validated configurations
 */
export class ConfigurationManager<T> {
  private config?: T;
  private schema: ZodSchema<T>;
  private logger: LoggerService;

  constructor(schema: ZodSchema<T>, name = 'config', logger?: LoggerService) {
    this.schema = schema;
    this.logger = logger || new LoggerService(`HAG.config.${name}`);
  }

  /**
   * Validate and set configuration
   */
  setConfig(config: unknown): void {
    const result = this.validate(config);
    if (!result.success) {
      throw new Error(result.error);
    }
    this.config = result.data;
    this.logger.debug('✅ Configuration set');
  }

  /**
   * Get configuration
   */
  getConfig(): T {
    if (!this.config) {
      throw new Error('Configuration not set');
    }
    return this.config;
  }

  /**
   * Validate configuration
   */
  private validate(config: unknown): ConfigValidationResult<T> {
    try {
      const validated = this.schema.parse(config);
      return { success: true, data: validated };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          success: false,
          error: `Configuration validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
      };
    }
  }
}

/**
 * Configuration registry for common and module-specific configurations
 */
export class ConfigurationRegistry {
  private commonConfig = new Map<string, unknown>();
  private moduleConfigs = new Map<string, unknown>();
  private logger: LoggerService;

  constructor(logger?: LoggerService) {
    this.logger = logger || new LoggerService('HAG.config-registry');
  }

  /**
   * Set common configuration
   */
  setCommonConfig(key: string, value: unknown): void {
    this.commonConfig.set(key, value);
    this.logger.debug(`📋 Set common config: ${key}`);
  }

  /**
   * Get common configuration
   */
  getCommonConfig<T>(key: string): T | undefined {
    return this.commonConfig.get(key) as T | undefined;
  }

  /**
   * Set module-specific configuration
   */
  setModuleConfig(module: string, config: unknown): void {
    this.moduleConfigs.set(module, config);
    this.logger.debug(`📋 Set module config: ${module}`);
  }

  /**
   * Get module-specific configuration
   */
  getModuleConfig<T>(module: string): T | undefined {
    return this.moduleConfigs.get(module) as T | undefined;
  }

  /**
   * Get merged configuration (common + module-specific)
   */
  getMergedConfig<T>(module: string): T {
    const common = Object.fromEntries(this.commonConfig);
    const moduleSpecific = this.moduleConfigs.get(module) || {};
    
    return { ...common, ...moduleSpecific } as T;
  }

  /**
   * Check if module has configuration
   */
  hasModuleConfig(module: string): boolean {
    return this.moduleConfigs.has(module);
  }

  /**
   * Get all registered modules
   */
  getRegisteredModules(): string[] {
    return Array.from(this.moduleConfigs.keys());
  }
}