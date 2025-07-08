/**
 * HVAC Module - implements the new module system
 * Provides HVAC domain actors through the unified module architecture
 */

import { Container } from '@needle-di/core';
import { BaseModule } from '../core/module-registry.ts';
import { HVACController } from './controller.ts';
import { HVACStateMachine } from './state-machine.ts';
import { TYPES } from '../core/types.ts';
import { HvacOptions } from '../config/config.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { ApplicationOptions } from '../config/config.ts';
import { EventBus } from '../core/event-system.ts';

/**
 * HVAC Module implementing the module system
 */
export class HvacModule extends BaseModule {
  readonly name = 'HVAC Control System';
  readonly domain = 'hvac';
  readonly version = '1.0.0';
  readonly description = 'HVAC temperature control and automation module';

  private stateMachine?: HVACStateMachine;
  private controller?: HVACController;
  private hvacConfig?: HvacOptions;
  private container?: Container;

  /**
   * Register services with container
   */
  override registerServices(container: Container): void {
    super.registerServices(container);
    this.container = container;
    this.logger?.debug('📍 HvacModule.registerServices() - Container registered');
  }

  /**
   * Initialize HVAC module
   */
  override async initialize(config: unknown): Promise<void> {
    await super.initialize(config);
    
    // Store HVAC configuration directly
    this.hvacConfig = config as HvacOptions;

    if (!this.container) {
      throw new Error('Container not registered - call registerServices first');
    }

    // Create instances of state machine and controller
    this.stateMachine = new HVACStateMachine(this.hvacConfig);
    this.controller = new HVACController(
      this.hvacConfig,
      this.container.get<ApplicationOptions>(TYPES.ApplicationOptions),
      this.container.get<HomeAssistantClient>(TYPES.HomeAssistantClient),
      this.stateMachine,
      this.container.get<EventBus>(TYPES.EventBus),
    );
    
    this.logger?.info('✅ HVAC module initialized');
  }

  /**
   * Get HVAC State Machine instance
   */
  getHVACStateMachine(): HVACStateMachine {
    if (!this.stateMachine) {
      throw new Error('HVAC State Machine not initialized');
    }
    return this.stateMachine;
  }

  /**
   * Get HVAC Controller instance
   */
  getHVACController(): HVACController {
    if (!this.controller) {
      throw new Error('HVAC Controller not initialized');
    }
    return this.controller;
  }

  /**
   * Cleanup HVAC module
   */
  override async dispose(): Promise<void> {
    this.logger?.info('🧹 Disposing HVAC module');
    if (this.controller) {
      await this.controller.stop();
    }
    if (this.stateMachine) {
      this.stateMachine.stop();
    }
    await super.dispose();
  }
}