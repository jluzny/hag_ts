/**
 * HVAC Controller V3 - Module-registry based approach
 *
 * This controller works directly with the HVAC state machine
 * and removes dependency on the legacy actor system
 */

import { injectable } from '@needle-di/core';
import { LoggerService } from '../core/logging.ts';
import type { ApplicationOptions, HvacOptions } from '../config/config.ts';
import { HomeAssistantClient } from '../home-assistant/client-xs.ts';
import { HVACMode, HVACStatus, OperationResult } from '../types/common.ts';
import { HVACOperationError, StateError } from '../core/exceptions.ts';
import { AppEvent, EventBus } from '../core/event-system.ts';
import { HVACStateMachine } from './state-machine.ts';


/**
 * Mode change request event
 */
class ModeChangeRequestEvent extends AppEvent {
  constructor(mode: string, temperature?: number) {
    super('hvac.mode_change_request', { mode, temperature });
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

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    haClient?: HomeAssistantClient,
    stateMachine?: HVACStateMachine,
    eventBus?: EventBus,
  ) {
    this.logger = new LoggerService('HAG.hvac.controller-v3');
    this.logger.debug('📍 HVACController.constructor() ENTRY');
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.haClient = haClient!;
    this.stateMachine = stateMachine!;
    this.eventBus = eventBus!;
    this.logger.debug('📍 HVACController.constructor() EXIT');
  }

  /**
   * Start the HVAC controller using state machine directly
   */
  async start(): Promise<void> {
    this.logger.debug('📍 HVACController.start() ENTRY');
    if (this.running) {
      this.logger.warning('🔄 HVAC controller already running');
      this.logger.debug('📍 HVACController.start() EXIT');
      return;
    }

    this.logger.info('🚀 Starting HVAC controller with state machine', {
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi,
      hvacEntities: this.hvacOptions.hvacEntities.length,
      enabledEntities: this.hvacOptions.hvacEntities.filter((e) =>
        e.enabled
      ).length,
    });

    try {
      this.abortController = new AbortController();

      // Step 1: Connect to Home Assistant
      this.logger.info('⚙️ Step 1: Connecting to Home Assistant');
      await this.haClient.connect();
      this.logger.info('✅ Step 1 completed: Home Assistant connected');

      // Step 2: Start HVAC state machine
      this.logger.info('⚙️ Step 2: Starting HVAC state machine');
      this.stateMachine.start();
      this.logger.info('✅ Step 2 completed: HVAC state machine started');

      // Step 3: Setup event-driven temperature monitoring
      this.logger.info('⚙️ Step 3: Setting up event-driven temperature monitoring');
      await this.setupEventDrivenMonitoring();
      this.logger.info('✅ Step 3 completed: Event-driven monitoring setup');

      this.running = true;

      this.logger.info('🎉 HVAC controller started successfully', {
        currentState: this.stateMachine.getCurrentState(),
        status: this.stateMachine.getStatus(),
      });
    } catch (error) {
      this.logger.error('❌ Failed to start HVAC controller', error);
      await this.stop();
      throw error;
    }
    this.logger.debug('📍 HVACController.start() EXIT');
  }

  /**
   * Stop the HVAC controller
   */
  async stop(): Promise<void> {
    this.logger.debug('📍 HVACController.stop() ENTRY');
    if (!this.running) {
      this.logger.warning('⚠️ HVAC controller not running');
      this.logger.debug('📍 HVACController.stop() EXIT');
      return;
    }

    this.logger.info('🛑 Stopping HVAC controller');

    // Stop event monitoring
    if (this.abortController) {
      this.abortController.abort();
    }

    // Clear sensor update interval
    if (this.sensorUpdateInterval) {
      clearInterval(this.sensorUpdateInterval);
      this.sensorUpdateInterval = undefined;
    }

    // Stop state machine
    this.logger.debug('⚙️ Stopping HVAC state machine');
    this.stateMachine.stop();
    this.logger.debug('✅ HVAC state machine stopped');

    // Disconnect from Home Assistant
    try {
      await this.haClient.disconnect();
      this.logger.debug('✅ Home Assistant disconnected');
    } catch (error) {
      this.logger.warning('⚠️ Error disconnecting from Home Assistant', {
        error,
      });
    }

    this.running = false;

    this.logger.info('✅ HVAC controller stopped successfully');
    this.logger.debug('📍 HVACController.stop() EXIT');
  }

  /**
   * Get current status
   */
  getStatus(): HVACStatus {
    this.logger.debug('📍 HVACController.getStatus() ENTRY');
    try {
      const haConnected = this.haClient.connected;
      const currentState = this.stateMachine.getCurrentState();
      const hvacMode = this.getCurrentHVACMode();

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
        },
        timestamp: new Date().toISOString(),
      };

      this.logger.debug('📍 HVACController.getStatus() EXIT');
      return status;
    } catch (error) {
      this.logger.error('❌ Failed to get status', error);
      this.logger.debug('📍 HVACController.getStatus() EXIT');
      throw new StateError('Failed to get HVAC status');
    }
  }

  /**
   * Trigger manual evaluation
   */
  triggerEvaluation(): OperationResult {
    if (!this.running) {
      throw new StateError('HVAC controller is not running');
    }

    try {
      // Send evaluation request directly to state machine
      this.stateMachine.send({ type: 'AUTO_EVALUATE' });
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('❌ Manual evaluation failed', error);
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
    this.logger.debug('📍 HVACController.manualOverride() ENTRY');
    try {
      this.logger.info('🎛️ Processing manual override via events', {
        action,
        options,
      });

      const mode = options.mode as HVACMode;
      const temperature = options.temperature as number | undefined;

      if (!mode) {
        throw new HVACOperationError('Mode is required for manual override');
      }

      // Send mode change request event
      const event = new ModeChangeRequestEvent(mode, temperature);
      this.eventBus.publishEvent(event);

      this.logger.info('✅ Manual override event published', {
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
      this.logger.debug('📍 HVACController.manualOverride() EXIT');
      return result;
    } catch (error) {
      this.logger.error('❌ Manual override failed', error, {
        action,
        options,
      });

      const result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
      this.logger.debug('📍 HVACController.manualOverride() EXIT');
      return result;
    }
  }

  /**
   * Setup event-driven temperature monitoring
   */
  private async setupEventDrivenMonitoring(): Promise<void> {
    this.logger.debug('📍 HVACController.setupEventDrivenMonitoring() ENTRY');
    // Get all sensors for HVAC system
    const sensors = this.getSensors();
    
    this.logger.info('📡 Setting up event-driven monitoring for sensors', {
      sensors: sensors,
      totalSensors: sensors.length,
    });

    // Setup Home Assistant event filtering for temperature sensors
    this.setupSensorsEventHandling(sensors);
    
    // Subscribe HVAC domain actor to event bus
    this.setupEventBusSubscription();
    
    // Get initial sensor readings once at startup
    await this.getInitialSensorReadings();
    this.logger.debug('📍 HVACController.setupEventDrivenMonitoring() EXIT');
  }

  /**
   * Setup event bus subscription for manual operations only
   */
  private setupEventBusSubscription(): void {
    this.logger.info('📡 Setting up event bus subscription for manual operations');

    // Only subscribe to manual override events (sensors handled directly via HA events)
    this.eventBus.subscribeToEvent('hvac.mode_change_request', (event) => {
      this.handleModeChangeRequest(event);
    });

    this.eventBus.subscribeToEvent('hvac.evaluate_conditions', (_event) => {
      this.handleEvaluateConditions();
    });

    this.logger.info('✅ Event bus subscription setup complete');
  }

  /**
   * Get all sensors for HVAC system
   */
  private getSensors(): string[] {
    this.logger.debug('📍 HVACController.getSensors() ENTRY');
    const sensors = [
      this.hvacOptions.tempSensor,
      this.hvacOptions.outdoorSensor,
    ];
    this.logger.debug('📍 HVACController.getSensors() EXIT');
    return sensors;
  }

  /**
   * Setup event handling for sensors
   */
  private setupSensorsEventHandling(sensors: string[]): void {
    this.logger.debug('📍 HVACController.setupSensorsEventHandling() ENTRY');
    this.logger.info('📡 Setting up event handlers for sensors', {
      sensors,
      totalSensors: sensors.length,
    });

    // Register event handler for sensor changes
    this.haClient.onStateChanged((entityId, oldState, newState) => {
      if (sensors.includes(entityId)) {
        this.logger.debug('📊 Sensor event received', {
          entityId,
          oldState,
          newState,
          timestamp: new Date().toISOString(),
        });

        // Trigger sensor update
        this.handleSensorChange(entityId, newState);
      }
    });

    this.logger.info('✅ Event handlers registered for sensors', {
      sensors,
      totalSensors: sensors.length,
    });
    this.logger.debug('📍 HVACController.setupSensorsEventHandling() EXIT');
  }

  /**
   * Handle sensor state changes - process only the changed sensor
   */
  private handleSensorChange(entityId: string, newState: string): void {
    try {
      this.logger.debug('📊 Processing single sensor change', {
        entityId,
        newState,
        timestamp: new Date().toISOString(),
      });

      // Get current temperatures from state machine context and update only the changed sensor
      const currentContext = this.stateMachine.getStatus().context;
      let indoorTemp = currentContext.indoorTemp;
      let outdoorTemp = currentContext.outdoorTemp;

      // Update only the sensor that changed
      if (entityId === this.hvacOptions.tempSensor) {
        indoorTemp = parseFloat(newState);
      } else if (entityId === this.hvacOptions.outdoorSensor) {
        outdoorTemp = parseFloat(newState);
      }

      // Send temperature update directly to state machine
      if (indoorTemp !== undefined && outdoorTemp !== undefined) {
        this.stateMachine.send({
          type: 'UPDATE_TEMPERATURES',
          indoor: indoorTemp,
          outdoor: outdoorTemp,
        });
      }
    } catch (error) {
      this.logger.error('❌ Failed to handle sensor change', error, {
        entityId,
        newState,
      });
    }
  }

  /**
   * Get initial sensor readings at startup only
   */
  private async getInitialSensorReadings(): Promise<void> {
    try {
      this.logger.info('📊 Getting initial sensor readings');

      const sensors = this.getSensors();
      const sensorStates: Record<string, string> = {};

      // Get all sensor readings once at startup
      for (const sensorId of sensors) {
        const state = await this.haClient.getState(sensorId);
        sensorStates[sensorId] = state.state;
      }

      // Parse temperatures and send directly to state machine
      const indoorTemp = parseFloat(sensorStates[this.hvacOptions.tempSensor]);
      const outdoorTemp = parseFloat(sensorStates[this.hvacOptions.outdoorSensor]);

      this.logger.info('🌡️ Initial temperature readings', {
        indoorTemp,
        outdoorTemp,
        indoorSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
      });

      // Send initial temperatures directly to state machine
      this.stateMachine.send({
        type: 'UPDATE_TEMPERATURES',
        indoor: indoorTemp,
        outdoor: outdoorTemp,
      });

    } catch (error) {
      this.logger.error('❌ Failed to get initial sensor readings', error);
    }
  }

  /**
   * Get current HVAC mode from actor
   */
  private getCurrentHVACMode(): HVACMode {
    this.logger.debug('📍 HVACController.getCurrentHVACMode() ENTRY');
    
    try {
      const currentState = this.stateMachine.getCurrentState();
      
      // Map state machine states to HVAC modes
      switch (currentState) {
        case 'heating':
          this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
          return HVACMode.HEAT;
        case 'cooling':
          this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
          return HVACMode.COOL;
        case 'idle':
        case 'evaluating':
        case 'defrosting':
        default:
          this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
          return HVACMode.OFF;
      }
    } catch (error) {
      this.logger.warning('⚠️ Error getting current HVAC mode', error instanceof Error ? { error: error.message } : { error: String(error) });
      this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
      return HVACMode.OFF;
    }
  }

  /**
   * Check if controller is running
   */
  isRunning(): boolean {
    this.logger.debug('📍 HVACController.isRunning() ENTRY');
    this.logger.debug('📍 HVACController.isRunning() EXIT');
    return this.running;
  }


  /**
   * Handle mode change requests
   */
  private handleModeChangeRequest(event: AppEvent): void {
    this.logger.debug('📍 HVACController.handleModeChangeRequest() ENTRY');
    const payload = event.payload as { mode: string; temperature?: number };
    
    this.logger.info('🎛️ Processing mode change request via state machine', {
      mode: payload.mode,
      temperature: payload.temperature,
    });

    // Send mode change event to state machine
    this.stateMachine.send({
      type: 'MODE_CHANGE',
      mode: payload.mode as HVACMode,
      temperature: payload.temperature,
    });
    
    this.logger.debug('📍 HVACController.handleModeChangeRequest() EXIT');
  }

  /**
   * Handle condition evaluation requests
   */
  private handleEvaluateConditions(): void {
    this.logger.debug('📍 HVACController.handleEvaluateConditions() ENTRY');
    
    this.logger.info('🔍 Processing condition evaluation request via state machine');

    // Send AUTO_EVALUATE event to state machine (event-driven approach)
    this.stateMachine.send({ type: 'AUTO_EVALUATE' });
    
    this.logger.debug('📍 HVACController.handleEvaluateConditions() EXIT');
  }

}

