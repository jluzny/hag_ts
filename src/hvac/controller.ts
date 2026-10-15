/**
 * HVAC Controller V3 - Module-registry based approach
 *
 * This controller works directly with the HVAC state machine
 * and removes dependency on the legacy actor system
 */

import { injectable } from "@needle-di/core";
import { LoggerService } from "../core/logging.ts";
import type { ApplicationOptions, HvacOptions } from "../config/config.ts";
import { HomeAssistantClient } from "../home-assistant/client.ts";
import { HVACMode, HVACStatus, OperationResult } from "../types/common.ts";
import { HVACOperationError, StateError } from "../core/exceptions.ts";
import { AppEvent, EventBus } from "../core/event-system.ts";
import { HVACStateMachine } from "./state-machine.ts";
import { SensorHealthMonitor, type SensorRole } from "./sensor-health.ts";
import { HVACContext } from "../types/common.ts";

/**
 * Mode change request event
 */
class ModeChangeRequestEvent extends AppEvent {
  constructor(mode: string, temperature?: number, presetMode?: string) {
    super("hvac.mode_change_request", { mode, temperature, presetMode });
  }
}

@injectable()
export class HVACController {
  private running = false;
  private abortController?: AbortController;

  private hvacOptions: HvacOptions;
  private appOptions: ApplicationOptions;
  private haClient: HomeAssistantClient;
  private logger: LoggerService;
  private eventBus: EventBus;
  private stateMachine: HVACStateMachine;
  private sensorUpdateInterval?: number;
  /** Hall/outdoor failure detection (issue 2) — shared with the state machine. */
  private sensorHealth: SensorHealthMonitor;
  /** True once the HA connection was lost, so a later reconnect reconciles. */
  private connectionWasLost = false;
  /** Read-back result of the last post-reconnect reconcile. */
  private lastReconcile?: HVACStatus["lastReconcile"];

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    haClient?: HomeAssistantClient,
    stateMachine?: HVACStateMachine,
    eventBus?: EventBus,
    sensorHealth?: SensorHealthMonitor,
  ) {
    this.logger = new LoggerService("HAG.hvac.controller");
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.haClient = haClient!;
    this.stateMachine = stateMachine!;
    this.eventBus = eventBus!;
    this.sensorHealth =
      sensorHealth ??
      new SensorHealthMonitor({
        entityIds: {
          hall: this.hvacOptions.tempSensor,
          outdoor: this.hvacOptions.outdoorSensor,
        },
        reportTimeoutMs: this.hvacOptions.sensorHealth?.reportTimeoutMs,
        dailyReminderMs:
          this.hvacOptions.sensorHealth?.dailyReminderHours !== undefined
            ? this.hvacOptions.sensorHealth.dailyReminderHours * 60 * 60 * 1000
            : undefined,
        logger: this.logger,
        // Freshness evidence is Home Assistant's own report timestamp. Reading
        // it re-asks HA for its stored report time; it is never treated as a
        // new report by itself.
        readReport: async (role: SensorRole, entityId: string) => {
          const state = await this.haClient.getState(entityId);
          return {
            entityId,
            rawState: state.state,
            reportedAt: state.lastReported ?? state.lastUpdated,
          };
        },
        // A probe-detected recovery (a fresh report is no state_changed event)
        // must still reevaluate the normal heating rules exactly once.
        onRecovery: (role: SensorRole, value: number) => {
          void this.handleSensorRecovery(role, value);
        },
        // Retained fallback values go through the same calibration the live
        // readings use (fallback eligibility must not diverge from live).
        calibrate: (role: SensorRole, value: number) =>
          this.applyCalibration(
            role === "hall"
              ? this.hvacOptions.tempSensor
              : this.hvacOptions.outdoorSensor,
            value,
          ),
      });
  }

  /**
   * Start the HVAC controller using state machine directly
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warning("🔄 HVAC controller already running");
      return;
    }

    this.logger.info("🚀 Starting HVAC controller with state machine", {
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi,
      hvacEntities: this.hvacOptions.hvacEntities.length,
      enabledEntities: this.hvacOptions.hvacEntities.filter((e) => e.enabled)
        .length,
    });

    try {
      this.abortController = new AbortController();

      // Step 1: Connect to Home Assistant
      this.logger.info("⚙️ Step 1: Connecting to Home Assistant");
      await this.haClient.connect();
      this.logger.info("✅ Step 1 completed: Home Assistant connected");

      // Step 2: Start HVAC state machine
      this.logger.info("⚙️ Step 2: Starting HVAC state machine");
      this.stateMachine.start();
      this.logger.info("✅ Step 2 completed: HVAC state machine started");

      // Connection loss/recovery: alert, retry (client-side) and reconcile.
      this.haClient.onConnectionStateChange(this.handleConnectionStateChange);

      // Step 3: Setup event-driven temperature monitoring
      this.logger.info(
        "⚙️ Step 3: Setting up event-driven temperature monitoring",
      );
      await this.setupEventDrivenMonitoring();
      this.logger.info("✅ Step 3 completed: Event-driven monitoring setup");

      this.running = true;

      this.logger.info("🎉 HVAC controller started successfully", {
        currentState: this.stateMachine.getCurrentState(),
        status: this.stateMachine.getStatus(),
      });
    } catch (error) {
      this.logger.error("❌ Failed to start HVAC controller", error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the HVAC controller
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.logger.warning("⚠️ HVAC controller not running");
      return;
    }

    this.logger.info("🛑 Stopping HVAC controller");

    // Stop event monitoring
    if (this.abortController) {
      this.abortController.abort();
    }

    // Stop observing connection transitions and cancel fault/reminder timers.
    this.haClient.removeConnectionStateChangeHandler(
      this.handleConnectionStateChange,
    );
    this.sensorHealth.dispose();

    // Clear sensor update interval
    if (this.sensorUpdateInterval) {
      clearInterval(this.sensorUpdateInterval);
      this.sensorUpdateInterval = undefined;
    }

    // Stop state machine
    this.logger.debug("⚙️ Stopping HVAC state machine");
    await this.stateMachine.stop();
    this.logger.debug("✅ HVAC state machine stopped");

    // Disconnect from Home Assistant
    try {
      await this.haClient.disconnect();
      this.logger.debug("✅ Home Assistant disconnected");
    } catch (error) {
      this.logger.warning("⚠️ Error disconnecting from Home Assistant", {
        error,
      });
    }

    this.running = false;

    this.logger.info("✅ HVAC controller stopped successfully");
  }

  /**
   * Connection up/down handling (issue 2).
   *
   * Loss: alert through the configured route and record that the outage
   * happened — no command is claimed to have succeeded while unreachable and
   * the schedule cutoff cannot be guaranteed.
   * Recovery: read the actual device and sensor state, ask the machine to
   * reconcile it with the current schedule, then read the units back.
   */
  private handleConnectionStateChange = (connected: boolean): void => {
    if (!connected) {
      this.connectionWasLost = true;
      this.sensorHealth.noteHaDisconnected();
      this.logger.warning(
        "⚠️ Home Assistant unreachable - commands cannot be confirmed and the schedule cutoff is not guaranteed",
      );
      return;
    }

    if (!this.connectionWasLost) return; // initial connect: startup path covers it
    this.connectionWasLost = false;
    this.sensorHealth.noteHaConnected();
    void this.reconcileAfterReconnect();
  };

  /**
   * Reconcile after a reconnect: read what the device and the sensors actually
   * report now, let the machine apply the current schedule and the
   * normal/fallback rules (including commanding managed units off outside
   * active hours), then read the units back instead of assuming the commands
   * took effect.
   */
  private async reconcileAfterReconnect(): Promise<void> {
    const enabled = this.hvacOptions.hvacEntities.filter((e) => e.enabled);

    try {
      this.logger.info("🔄 Reconciling after Home Assistant reconnect", {
        units: enabled.map((entity) => entity.entityId),
      });

      // 1. Actual sensor state (freshness evidence per report timestamp).
      for (const sensorId of this.getSensors()) {
        const role: SensorRole =
          sensorId === this.hvacOptions.tempSensor ? "hall" : "outdoor";
        try {
          const state = await this.haClient.getState(sensorId);
          this.sensorHealth.report(role, {
            entityId: sensorId,
            rawState: state.state,
            reportedAt: state.lastReported ?? state.lastUpdated,
          });
        } catch (error) {
          this.logger.warning("⚠️ Post-reconnect sensor read failed", {
            entityId: sensorId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 2. Actual unit state. A unit that cannot be read is reported as
      //    unreadable — never assumed off and never assumed commanded.
      const observedUnits: Array<{ entityId: string; state: string }> = [];
      const unreadable: string[] = [];
      for (const entity of enabled) {
        try {
          const state = await this.haClient.getState(entity.entityId);
          observedUnits.push({ entityId: entity.entityId, state: state.state });
        } catch {
          unreadable.push(entity.entityId);
        }
      }

      // 3. Reconcile on the ordinary evaluation paths with a freshly read clock.
      //    The witness window opens first: it captures exactly the off commands
      //    the machine issues while processing the reconcile (review round 1 F4).
      this.stateMachine.beginReconcileWitness();
      this.stateMachine.send({ type: "HA_RECONNECTED", observedUnits });

      // 4. Let the machine's queued commands settle before reading back.
      await this.stateMachine.awaitPendingCommands();
      await this.verifyReconciledUnits(unreadable);
    } catch (error) {
      this.logger.error("❌ Post-reconnect reconcile failed", error);
    }
  }

  /**
   * Read the units back after a reconcile and record the observed result.
   *
   * `commandedOff` is the witness of the off commands the machine issued while
   * processing the reconcile — only successfully delivered sends are included
   * (review round 1 F4). The read-back verifies exactly those units and never
   * claims an effect for a command that was not issued: a machine that
   * deliberately commanded nothing (e.g. an active defrost cycle or a manual
   * override winning outside active hours) records an empty list, and the
   * "did not report off" warning cannot fire for units nobody commanded.
   */
  private async verifyReconciledUnits(alreadyUnreadable: string[]): Promise<void> {
    const withinActiveHours = this.stateMachine.isWithinActiveHours();
    const commandedOff = this.stateMachine.takeReconciledOffCommands();

    const stillNotOff: string[] = [];
    const unreadable = [...alreadyUnreadable];

    for (const entityId of commandedOff) {
      try {
        const state = await this.haClient.getState(entityId);
        if (state.state !== "off") stillNotOff.push(entityId);
      } catch {
        if (!unreadable.includes(entityId)) unreadable.push(entityId);
      }
    }

    this.lastReconcile = {
      at: new Date().toISOString(),
      commandedOff,
      stillNotOff,
      unreadable,
    };

    if (stillNotOff.length > 0) {
      this.logger.warning(
        "⚠️ Post-reconnect read-back: units commanded off did not report off",
        { stillNotOff, commandedOff },
      );
    } else if (!withinActiveHours && commandedOff.length === 0) {
      // The machine commanded nothing off during the reconcile. That is a
      // deliberate machine decision, not a lost command: it must not be
      // reported as a defect, and there is nothing to read back.
      this.logger.info(
        "✅ Post-reconnect read-back recorded - no off commands were issued during the reconcile (machine state, e.g. an active defrost cycle or a manual override, commands nothing)",
        this.lastReconcile,
      );
    } else {
      this.logger.info("✅ Post-reconnect read-back recorded", this.lastReconcile);
    }
  }

  /** Shared sensor failure detection state (issue 2). */
  getSensorHealth(): SensorHealthMonitor {
    return this.sensorHealth;
  }

  /**
   * Get current status
   */
  getStatus(): HVACStatus {
    try {
      const haConnected = this.haClient.connected;
      const currentState = this.stateMachine.getCurrentState();
      const hvacMode = this.getCurrentHVACMode();

      // Once the state machine is stopped its context is not readable (getContext
      // throws). The controller's own sensor-health monitor still is, so the
      // degraded status survives a stop instead of taking the status call down.
      let conditions: HVACContext | undefined;
      let degraded: HVACStatus["degraded"] = this.sensorHealth.status();
      try {
        const machineStatus = this.stateMachine.getStatus();
        conditions = machineStatus.context;
        degraded = machineStatus.degraded;
      } catch {
        this.logger.debug(
          "ℹ️ State machine context unavailable for status (machine stopped)",
        );
      }

      const status: HVACStatus = {
        controller: {
          running: this.running,
          haConnected: haConnected,
          tempSensor: this.hvacOptions.tempSensor,
          systemMode: this.hvacOptions.systemMode,
          aiEnabled: this.appOptions.useAi,
        },
        stateMachine: {
          currentState: currentState,
          hvacMode: hvacMode,
          conditions: conditions,
        },
        timestamp: new Date().toISOString(),
        // Explicit degraded status, separate from the HVAC state.
        degraded: degraded,
        lastReconcile: this.lastReconcile,
      };

      return status;
    } catch (error) {
      this.logger.error("❌ Failed to get status", error);
      throw new StateError("Failed to get HVAC status");
    }
  }

  /**
   * Trigger manual evaluation
   */
  triggerEvaluation(): OperationResult {
    if (!this.running) {
      throw new StateError("HVAC controller is not running");
    }

    try {
      // Manual evaluation event - only for explicit user requests
      this.stateMachine.send({ type: "AUTO_EVALUATE" });

      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("❌ Manual evaluation failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Manual override using event-driven approach
   */
  manualOverride(
    action: string,
    options: Record<string, unknown> = {},
  ): OperationResult {
    try {
      this.logger.info("🎛️ Processing manual override via events", {
        action,
        options,
      });

      const mode = options.mode as HVACMode;
      const temperature = options.temperature as number | undefined;
      const presetMode = options.presetMode as string | undefined;

      if (!mode) {
        throw new HVACOperationError("Mode is required for manual override");
      }

      // Send mode change request event
      const event = new ModeChangeRequestEvent(mode, temperature, presetMode);
      this.eventBus.publishEvent(event);

      this.logger.info("✅ Manual override event published", {
        action,
        mode,
        temperature,
        eventType: event.type,
      });

      const result = {
        success: true,
        data: { action, mode, temperature, eventPublished: true },
        timestamp: new Date().toISOString(),
      };
      return result;
    } catch (error) {
      this.logger.error("❌ Manual override failed", error, {
        action,
        options,
      });

      const result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
      return result;
    }
  }

  /**
   * Setup event-driven temperature monitoring
   */
  private async setupEventDrivenMonitoring(): Promise<void> {
    // Get all sensors for HVAC system
    const sensors = this.getSensors();

    this.logger.info("📡 Setting up event-driven monitoring for sensors", {
      sensors: sensors,
      totalSensors: sensors.length,
    });

    // Setup Home Assistant event filtering for temperature sensors
    this.setupSensorsEventHandling(sensors);

    // Subscribe HVAC domain actor to event bus
    this.setupEventBusSubscription();

    // Get initial sensor readings once at startup
    await this.getInitialSensorReadings();
  }

  /**
   * Setup event bus subscription for manual operations only
   */
  private setupEventBusSubscription(): void {
    this.logger.info(
      "📡 Setting up event bus subscription for manual operations",
    );

    // Only subscribe to manual override events (sensors handled directly via HA events)
    this.eventBus.subscribeToEvent("hvac.mode_change_request", (event) => {
      this.handleModeChangeRequest(event);
    });

    this.eventBus.subscribeToEvent("hvac.evaluate_conditions", (_event) => {
      this.handleEvaluateConditions();
    });

    this.logger.info("✅ Event bus subscription setup complete");
  }

  /**
   * Get all sensors for HVAC system
   */
  private getSensors(): string[] {
    const sensors = [
      this.hvacOptions.tempSensor,
      this.hvacOptions.outdoorSensor,
    ];
    return sensors;
  }

  /**
   * Setup event handling for sensors
   */
  private setupSensorsEventHandling(sensors: string[]): void {
    this.logger.info("📡 Setting up event handlers for sensors", {
      sensors,
      totalSensors: sensors.length,
    });

    // Register event handler for sensor changes
    // Pass monitored sensors so even same-value updates trigger re-evaluation
    const monitoredSensorIds = new Set(sensors);
    this.haClient.onStateChanged((entityId, oldState, newState, stateData) => {
      if (sensors.includes(entityId)) {
        this.logger.debug("📊 Sensor event received", {
          entityId,
          oldState,
          newState,
          timestamp: new Date().toISOString(),
        });

        // Handle sensor update
        this.handleSensorChange(entityId, newState, stateData);
      }
    }, monitoredSensorIds);

    this.logger.info("✅ Event handlers registered for sensors", {
      sensors,
      totalSensors: sensors.length,
    });
  }

  /**
   * Handle sensor state changes - process only the changed sensor
   */
  private handleSensorChange(
    entityId: string,
    newState: string,
    newStateData?: {
      lastReported?: Date;
      lastUpdated?: Date;
    },
  ): void {
    try {
      this.logger.debug("📊 Processing single sensor change", {
        entityId,
        newState,
        timestamp: new Date().toISOString(),
      });

      // Confirmed report: record Home Assistant's own report timestamp before
      // deciding anything, so freshness is never inferred from the value.
      if (
        entityId === this.hvacOptions.tempSensor ||
        entityId === this.hvacOptions.outdoorSensor
      ) {
        const role: SensorRole =
          entityId === this.hvacOptions.tempSensor ? "hall" : "outdoor";
        this.sensorHealth.report(role, {
          entityId,
          rawState: newState,
          reportedAt:
            newStateData?.lastReported ?? newStateData?.lastUpdated ?? new Date(),
        });
      }

      // Get current temperatures from state machine context
      const currentContext = this.stateMachine.getStatus().context;
      const updatedData: Partial<HVACContext> = {
        currentHour: new Date().getHours(),
        isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
      };
      let updateType: string;

      // Handle each sensor type individually
      if (entityId === this.hvacOptions.tempSensor) {
        const rawTemp = parseFloat(newState);
        updatedData.indoorTemp = this.applyCalibration(entityId, rawTemp);
        updateType = "indoor_temperature_change";

        this.logger.debug("🌡️ Indoor sensor change with calibration", {
          sensorId: entityId,
          rawTemp: `${rawTemp.toFixed(1)}°C`,
          calibratedTemp: `${updatedData.indoorTemp.toFixed(1)}°C`,
          offset: this.hvacOptions.temperatureCalibration?.[entityId]
            ? `${this.hvacOptions.temperatureCalibration[entityId] >= 0 ? '+' : ''}${this.hvacOptions.temperatureCalibration[entityId].toFixed(1)}°C`
            : 'none'
        });

        // Include current outdoor temp to maintain complete context
        if (currentContext.outdoorTemp !== undefined) {
          updatedData.outdoorTemp = currentContext.outdoorTemp;
        }
      } else if (entityId === this.hvacOptions.outdoorSensor) {
        const rawTemp = parseFloat(newState);
        updatedData.outdoorTemp = this.applyCalibration(entityId, rawTemp);
        updateType = "outdoor_temperature_change";

        this.logger.debug("🌡️ Outdoor sensor change with calibration", {
          sensorId: entityId,
          rawTemp: `${rawTemp.toFixed(1)}°C`,
          calibratedTemp: `${updatedData.outdoorTemp.toFixed(1)}°C`,
          offset: this.hvacOptions.temperatureCalibration?.[entityId]
            ? `${this.hvacOptions.temperatureCalibration[entityId] >= 0 ? '+' : ''}${this.hvacOptions.temperatureCalibration[entityId].toFixed(1)}°C`
            : 'none'
        });

        // Include current indoor temp to maintain complete context
        if (currentContext.indoorTemp !== undefined) {
          updatedData.indoorTemp = currentContext.indoorTemp;
        }
      } else {
        // Not a monitored sensor, skip
        return;
      }

      // Send sensor update to state machine only if we have both temperatures
      if (
        updatedData.indoorTemp !== undefined &&
        updatedData.outdoorTemp !== undefined
      ) {
        this.stateMachine.send({
          type: "UPDATE_CONDITIONS",
          data: updatedData,
          eventSource: {
            type: updateType,
            entityId,
            newValue: newState,
            previousValue:
              entityId === this.hvacOptions.tempSensor
                ? currentContext.indoorTemp?.toString()
                : currentContext.outdoorTemp?.toString(),
          },
        });
      }
    } catch (error) {
      this.logger.error("❌ Failed to handle sensor change", error, {
        entityId,
        newState,
      });
    }
  }

  /**
   * Probe-detected sensor recovery: reevaluate the normal heating rules ONCE.
   *
   * A recovery seen only through the freshness probe produces no
   * `state_changed` event, so nothing else triggers an evaluation; this reads
   * both sensors fresh (recording the report evidence like startup does) and
   * sends one UPDATE_CONDITIONS. Called by the sensor-health monitor exactly
   * once per recovery episode.
   */
  async handleSensorRecovery(role: SensorRole, value: number): Promise<void> {
    try {
      this.logger.info("🔁 Sensor recovery reevaluation", {
        role,
        recoveredValue: value,
      });

      const updatedData: Partial<HVACContext> = {
        currentHour: new Date().getHours(),
        isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
      };

      for (const sensorId of this.getSensors()) {
        try {
          const state = await this.haClient.getState(sensorId);
          this.sensorHealth.report(sensorId === this.hvacOptions.tempSensor ? "hall" : "outdoor", {
            entityId: sensorId,
            rawState: state.state,
            reportedAt: state.lastReported ?? state.lastUpdated,
          });
          const parsed = parseFloat(state.state);
          if (Number.isFinite(parsed)) {
            const calibrated = this.applyCalibration(sensorId, parsed);
            if (sensorId === this.hvacOptions.tempSensor) {
              updatedData.indoorTemp = calibrated;
            } else {
              updatedData.outdoorTemp = calibrated;
            }
          }
        } catch (error) {
          this.logger.warning("⚠️ Sensor recovery read failed", {
            entityId: sensorId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // One evaluation; the machine's ordinary update path decides the rest.
      if (
        updatedData.indoorTemp !== undefined &&
        updatedData.outdoorTemp !== undefined
      ) {
        this.stateMachine.send({
          type: "UPDATE_CONDITIONS",
          data: updatedData,
          eventSource: {
            type: "sensor_recovery",
            entityId:
              role === "hall"
                ? this.hvacOptions.tempSensor
                : this.hvacOptions.outdoorSensor,
            newValue: String(value),
          },
        });
        await this.stateMachine.awaitPendingCommands();
      }
    } catch (error) {
      this.logger.error("❌ Sensor recovery evaluation failed", error, {
        role,
      });
    }
  }

  /**
   * Apply temperature calibration offset to sensor reading
   */
  private applyCalibration(sensorId: string, rawTemp: number): number {
    const calibration = this.hvacOptions.temperatureCalibration;
    if (!calibration || !calibration[sensorId]) {
      return rawTemp; // No calibration configured
    }

    const offset = calibration[sensorId];
    const calibratedTemp = rawTemp + offset;

    this.logger.debug("🌡️ Temperature calibration applied", {
      sensorId,
      rawTemp: `${rawTemp.toFixed(1)}°C`,
      offset: `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}°C`,
      calibratedTemp: `${calibratedTemp.toFixed(1)}°C`,
    });

    return calibratedTemp;
  }

  /**
   * Get initial sensor readings at startup only
   */
  private async getInitialSensorReadings(): Promise<void> {
    try {
      this.logger.debug("📊 Getting initial sensor readings");

      const sensors = this.getSensors();
      const sensorStates: Record<string, string> = {};

      // Get all sensor readings once at startup. Home Assistant's own report
      // timestamp is the freshness reference: a failed read is an immediate
      // "no reading" fault, never an assumed reading.
      for (const sensorId of sensors) {
        const role: SensorRole =
          sensorId === this.hvacOptions.tempSensor ? "hall" : "outdoor";
        try {
          const state = await this.haClient.getState(sensorId);
          sensorStates[sensorId] = state.state;
          this.sensorHealth.report(role, {
            entityId: sensorId,
            rawState: state.state,
            reportedAt: state.lastReported ?? state.lastUpdated,
          });
        } catch (error) {
          this.logger.warning("⚠️ Startup sensor read failed", {
            entityId: sensorId,
            role,
            error: error instanceof Error ? error.message : String(error),
          });
          sensorStates[sensorId] = "";
          this.sensorHealth.noteNoReading(role);
        }
      }

      // Parse temperatures and apply calibration
      const rawIndoorTemp = parseFloat(sensorStates[this.hvacOptions.tempSensor]);
      const rawOutdoorTemp = parseFloat(
        sensorStates[this.hvacOptions.outdoorSensor],
      );

      const indoorTemp = this.applyCalibration(
        this.hvacOptions.tempSensor,
        rawIndoorTemp,
      );
      const outdoorTemp = this.applyCalibration(
        this.hvacOptions.outdoorSensor,
        rawOutdoorTemp,
      );

      this.logger.info("🌡️ Initial conditions read", {
        indoorTemp,
        outdoorTemp,
        indoorSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
        calibration: {
          indoor: {
            raw: `${rawIndoorTemp.toFixed(1)}°C`,
            calibrated: `${indoorTemp.toFixed(1)}°C`,
            offset: this.hvacOptions.temperatureCalibration?.[this.hvacOptions.tempSensor]
              ? `${this.hvacOptions.temperatureCalibration[this.hvacOptions.tempSensor] >= 0 ? '+' : ''}${this.hvacOptions.temperatureCalibration[this.hvacOptions.tempSensor].toFixed(1)}°C`
              : 'none'
          },
          outdoor: {
            raw: `${rawOutdoorTemp.toFixed(1)}°C`,
            calibrated: `${outdoorTemp.toFixed(1)}°C`,
            offset: this.hvacOptions.temperatureCalibration?.[this.hvacOptions.outdoorSensor]
              ? `${this.hvacOptions.temperatureCalibration[this.hvacOptions.outdoorSensor] >= 0 ? '+' : ''}${this.hvacOptions.temperatureCalibration[this.hvacOptions.outdoorSensor].toFixed(1)}°C`
              : 'none'
          }
        }
      });

      // Send initial conditions to state machine
      this.stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp,
          outdoorTemp,
          currentHour: new Date().getHours(),
          isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
        },
        eventSource: {
          type: "initial_readings",
          indoorSensor: this.hvacOptions.tempSensor,
          outdoorSensor: this.hvacOptions.outdoorSensor,
        },
      });
    } catch (error) {
      this.logger.error("❌ Failed to get initial conditions readings", error);
    }
  }

  /**
   * Get current HVAC mode from actor
   */
  private getCurrentHVACMode(): HVACMode {
    try {
      const currentState = this.stateMachine.getCurrentState();

      // Map state machine states to HVAC modes
      switch (currentState) {
        case "heating":
          return HVACMode.HEAT;
        case "cooling":
          return HVACMode.COOL;
        case "idle":
        case "evaluating":
        case "defrosting":
        default:
          return HVACMode.OFF;
      }
    } catch (error) {
      this.logger.warning(
        "⚠️ Error getting current HVAC mode",
        error instanceof Error
          ? { error: error.message }
          : { error: String(error) },
      );
      return HVACMode.OFF;
    }
  }

  /**
   * Check if controller is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handle mode change requests
   */
  private handleModeChangeRequest(event: AppEvent): void {
    const payload = event.payload as {
      mode: string;
      temperature?: number;
      presetMode?: string;
    };

    this.logger.info("🎛️ Processing mode change request via state machine", {
      mode: payload.mode,
      temperature: payload.temperature,
      presetMode: payload.presetMode,
    });

    // Send mode change event to state machine
    this.stateMachine.send({
      type: "MODE_CHANGE",
      mode: payload.mode as HVACMode,
      temperature: payload.temperature,
      presetMode: payload.presetMode,
    });
  }

  /**
   * Handle condition evaluation requests
   */
  private handleEvaluateConditions(): void {
    this.logger.info(
      "🔍 Evaluation will be triggered automatically by state machine when temperatures update",
    );
  }
}
