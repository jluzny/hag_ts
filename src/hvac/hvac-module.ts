/**
 * HVAC Module - implements the new module system
 * Provides HVAC domain actors through the unified module architecture
 */

import { Container } from '@needle-di/core';
import { BaseModule } from '../core/module-registry.ts';
import { DomainActor, ActorFactory } from '../core/actor-bootstrap.ts';
import { ConfigurationManager } from '../core/config-system.ts';
import { HvacActorFactory } from './hvac-domain-actor.ts';
import { HvacActorService } from './hvac-actor-service.ts';
import { XStateHVACStateMachineAdapter } from './state-machine-xstate-adapter.ts';
import { TYPES } from '../core/types.ts';
import { HvacOptions, HvacOptionsSchema } from '../config/config.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';

/**
 * HVAC Module implementing the module system
 */
export class HvacModule extends BaseModule {
  readonly name = 'HVAC Control System';
  readonly domain = 'hvac';
  readonly version = '1.0.0';
  readonly description = 'HVAC temperature control and automation module';

  private configManager?: ConfigurationManager<HvacOptions>;

  /**
   * Initialize HVAC module
   */
  override async initialize(config: unknown): Promise<void> {
    await super.initialize(config);
    
    // Create configuration manager for HVAC
    this.configManager = new ConfigurationManager(
      HvacOptionsSchema,
      'hvac',
      this.logger
    );
    
    // Set and validate configuration
    this.configManager.setConfig(config);
    
    this.logger?.info('✅ HVAC module initialized');
  }

  /**
   * Create HVAC actor factory
   */
  createActorFactory(): ActorFactory<DomainActor> {
    if (!this.configManager) {
      throw new Error('HVAC module not initialized');
    }

    return new HvacActorFactory();
  }

  /**
   * Register HVAC-specific services in DI container
   */
  override registerServices(container: Container): void {
    super.registerServices(container);

    if (!this.configManager) {
      throw new Error('HVAC module not initialized - cannot register services');
    }

    const hvacConfig = this.configManager.getConfig();

    // Register HVAC state machine
    container.bind({
      provide: TYPES.HVACStateMachine,
      useFactory: () => {
        const logger = this.logger!;
        logger.info('🔄 Creating HVAC state machine implementation');
        return new XStateHVACStateMachineAdapter(hvacConfig, logger);
      },
    });

    // Register HVAC actor service
    container.bind({
      provide: TYPES.HvacActorService,
      useFactory: () => {
        const logger = this.logger!;
        const haClient = container.get(Symbol.for('HomeAssistantClient')) as HomeAssistantClient;
        
        return new HvacActorService(hvacConfig, logger, haClient);
      },
    });

    this.logger?.info('🔌 Registered HVAC services in DI container');
  }

  /**
   * Get required dependencies
   */
  override getRequiredDependencies(): symbol[] {
    return [
      ...super.getRequiredDependencies(),
      Symbol.for('HomeAssistantClient'),
    ];
  }

  /**
   * Validate HVAC configuration
   */
  override validateConfig(config: unknown): boolean {
    try {
      HvacOptionsSchema.parse(config);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get HVAC configuration
   */
  getConfig(): HvacOptions {
    if (!this.configManager) {
      throw new Error('HVAC module not initialized');
    }
    return this.configManager.getConfig();
  }

  /**
   * Cleanup HVAC module
   */
  override async dispose(): Promise<void> {
    this.logger?.info('🧹 Disposing HVAC module');
    await super.dispose();
  }
}