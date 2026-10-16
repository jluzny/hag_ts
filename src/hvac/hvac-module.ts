/**
 * HVAC Module - implements the new module system
 * Provides HVAC components through the unified module architecture
 */

import { injectable } from "@needle-di/core";
import { BaseModule } from "../core/module-registry.ts";
import { HVACController } from "./controller.ts";
import { HVACStateMachine } from "./state-machine.ts";
import { SensorHealthMonitor } from "./sensor-health.ts";
import { selectNotifier } from "./notifier.ts";
import type { HvacOptions, ApplicationOptions } from "../config/config.ts";
import { HomeAssistantClient } from "../home-assistant/client.ts";
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
  private sensorHealth: SensorHealthMonitor;

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    haClient?: HomeAssistantClient,
    eventBus?: EventBus,
  ) {
    super();

    // Initialize logger for this module
    this.logger = new LoggerService(`HAG.module.${this.domain}`);

    // Validate required dependencies
    if (!hvacOptions || !appOptions || !haClient || !eventBus) {
      throw new Error(
        "HvacModule requires all dependencies: hvacOptions, appOptions, haClient, eventBus",
      );
    }

    // Hall/outdoor failure detection (issue 2): one monitor instance shared by
    // the state machine and the controller, so guard decisions, status
    // reporting and alerts all read the same state.
    this.sensorHealth = new SensorHealthMonitor({
      entityIds: {
        hall: hvacOptions.tempSensor,
        outdoor: hvacOptions.outdoorSensor,
      },
      reportTimeoutMs: hvacOptions.sensorHealth?.reportTimeoutMs,
      dailyReminderMs:
        hvacOptions.sensorHealth?.dailyReminderHours !== undefined
          ? hvacOptions.sensorHealth.dailyReminderHours * 60 * 60 * 1000
          : undefined,
      notificationGraceMs:
        hvacOptions.sensorHealth?.notificationGraceMinutes !== undefined
          ? hvacOptions.sensorHealth.notificationGraceMinutes * 60 * 1000
          : undefined,
      notifier: selectNotifier(hvacOptions.alerts, this.logger!),
      logger: this.logger!,
      // Freshness evidence is Home Assistant's own report timestamp.
      readReport: async (role, entityId) => {
        const state = await haClient.getState(entityId);
        return {
          entityId,
          rawState: state.state,
          reportedAt: state.lastReported ?? state.lastUpdated,
        };
      },
      // A probe-detected recovery (a fresh report is no state_changed event)
      // must still reevaluate the normal heating rules exactly once.
      onRecovery: (role, value) => {
        void this.controller?.handleSensorRecovery(role, value);
      },
      // Retained fallback values go through the same calibration the live
      // readings use (fallback eligibility must not diverge from live).
      calibrate: (role, value) => {
        const sensorId =
          role === "hall" ? hvacOptions.tempSensor : hvacOptions.outdoorSensor;
        const offset = hvacOptions.temperatureCalibration?.[sensorId];
        return offset === undefined ? value : value + offset;
      },
    });

    // Create instances with injected dependencies
    this.stateMachine = new HVACStateMachine(
      hvacOptions,
      haClient,
      this.sensorHealth,
    );
    this.controller = new HVACController(
      hvacOptions,
      appOptions,
      haClient,
      this.stateMachine,
      eventBus,
      this.sensorHealth,
    );
  }

  /** Shared sensor failure detection state (issue 2). */
  getSensorHealth(): SensorHealthMonitor {
    return this.sensorHealth;
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
      await this.stateMachine.stop();
    }
    await super.dispose();
  }
}
