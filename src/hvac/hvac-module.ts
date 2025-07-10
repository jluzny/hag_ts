/**
 * HVAC Module - implements the new module system
 * Provides HVAC components through the unified module architecture
 */

import { injectable } from "@needle-di/core";
import { BaseModule } from "../core/module-registry.ts";
import { HVACController } from "./controller.ts";
import { HVACStateMachine } from "./state-machine.ts";
import type { HvacOptions, ApplicationOptions } from "../config/config.ts";
import { HomeAssistantClient } from "../home-assistant/client-xs.ts";
import { EventBus } from "../core/event-system.ts";
import { LoggerService } from "../core/logging.ts";

/**
 * HVAC Module implementing the module system with dependency injection
 */
@injectable()
export class HvacModule extends BaseModule {
  readonly name = "HVAC Control System";
  readonly domain = "hvac";
  readonly version = "1.0.0";
  readonly description = "HVAC temperature control and automation module";

  private stateMachine: HVACStateMachine;
  private controller: HVACController;

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    haClient?: HomeAssistantClient,
    eventBus?: EventBus,
  ) {
    super();

    // Initialize logger for this module
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    this.logger.debug("📍 HvacModule.constructor() ENTRY");

    // Validate required dependencies
    if (!hvacOptions || !appOptions || !haClient || !eventBus) {
      throw new Error(
        "HvacModule requires all dependencies: hvacOptions, appOptions, haClient, eventBus",
      );
    }

    // Create instances with injected dependencies
    this.stateMachine = new HVACStateMachine(hvacOptions, haClient);
    this.controller = new HVACController(
      hvacOptions,
      appOptions,
      haClient,
      this.stateMachine,
      eventBus,
    );

    this.logger.debug("📍 HvacModule.constructor() EXIT");
  }

  /**
   * Initialize HVAC module (simplified since dependencies are injected)
   */
  override initialize(config: unknown): Promise<void> {
    this.logger?.debug("📍 HvacModule.initialize() ENTRY");
    this.config = config;
    this.logger?.info("✅ HVAC module initialized");
    this.logger?.debug("📍 HvacModule.initialize() EXIT");
    return Promise.resolve();
  }

  /**
   * Get HVAC State Machine instance
   */
  getHVACStateMachine(): HVACStateMachine {
    if (!this.stateMachine) {
      throw new Error("HVAC State Machine not initialized");
    }
    return this.stateMachine;
  }

  /**
   * Get HVAC Controller instance
   */
  getHVACController(): HVACController {
    if (!this.controller) {
      throw new Error("HVAC Controller not initialized");
    }
    return this.controller;
  }

  /**
   * Cleanup HVAC module
   */
  override async dispose(): Promise<void> {
    this.logger?.info("🧹 Disposing HVAC module");
    if (this.controller) {
      await this.controller.stop();
    }
    if (this.stateMachine) {
      this.stateMachine.stop();
    }
    await super.dispose();
  }
}
