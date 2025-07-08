/**
 * HVAC Controller V2 - Uses generic actor bootstrap system
 *
 * This controller demonstrates how to use the generic actor framework
 * for domain-specific HVAC management
 */

import { injectable } from '@needle-di/core';
import { LoggerService } from '../core/logger.ts';
import type { ApplicationOptions, HvacOptions } from '../config/config.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { HVACMode, HVACStatus, OperationResult } from '../types/common.ts';
import { HVACOperationError, StateError } from '../core/exceptions.ts';
import { ActorBootstrap } from '../core/actor-bootstrap.ts';
import { AppEvent, EventBus } from '../core/event-system.ts';
import { HvacActorFactory, HvacDomainActor } from './hvac-domain-actor.ts';

/**
 * Sensor states update event
 */
class SensorStatesUpdateEvent extends AppEvent {
  constructor(sensorStates: Record<string, string>) {
    console.log('📍 SensorStatesUpdateEvent.constructor() ENTRY');
    super('hvac.sensor_states_updated', { sensorStates, timestamp: new Date().toISOString() });
    console.log('📍 SensorStatesUpdateEvent.constructor() EXIT');
  }
}

/**
 * Mode change request event
 */
class ModeChangeRequestEvent extends AppEvent {
  constructor(mode: string, temperature?: number) {
    console.log('📍 ModeChangeRequestEvent.constructor() ENTRY');
    super('hvac.mode_change_request', { mode, temperature });
    console.log('📍 ModeChangeRequestEvent.constructor() EXIT');
  }
}

/**
 * Condition evaluation request event
 */
class EvaluateConditionsEvent extends AppEvent {
  constructor() {
    console.log('📍 EvaluateConditionsEvent.constructor() ENTRY');
    super('hvac.evaluate_conditions', {});
    console.log('📍 EvaluateConditionsEvent.constructor() EXIT');
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
  private actorBootstrap: ActorBootstrap;
  private eventBus: EventBus;
  private hvacActor?: HvacDomainActor;

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    haClient?: HomeAssistantClient,
    actorBootstrap?: ActorBootstrap,
    eventBus?: EventBus,
  ) {
    console.log('📍 HVACController.constructor() ENTRY');
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.haClient = haClient!;
    this.actorBootstrap = actorBootstrap!;
    this.eventBus = eventBus!;
    this.logger = new LoggerService('HAG.hvac.controller-v2');
    console.log('📍 HVACController.constructor() EXIT');
  }

  /**
   * Start the HVAC controller using actor bootstrap
   */
  async start(): Promise<void> {
    this.logger.debug('📍 HVACController.start() ENTRY');
    if (this.running) {
      this.logger.warning('🔄 HVAC controller already running');
      this.logger.debug('📍 HVACController.start() EXIT');
      return;
    }

    this.logger.info('🚀 Starting HVAC controller with actor bootstrap', {
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

      // Step 2: Register HVAC actor with bootstrap system
      this.logger.info('⚙️ Step 2: Registering HVAC actor');
      const hvacFactory = new HvacActorFactory();
      const hvacConfig = {
        hvacOptions: this.hvacOptions,
        haClient: this.haClient,
      };

      this.actorBootstrap.registerActorFactory(hvacFactory, hvacConfig);
      this.logger.info('✅ Step 2 completed: HVAC actor registered');

      // Step 3: Start actor bootstrap system
      this.logger.info('⚙️ Step 3: Starting actor bootstrap system');
      await this.actorBootstrap.startAll();

      // Get reference to HVAC actor
      this.hvacActor = this.actorBootstrap.getActor('hvac') as HvacDomainActor;
      this.logger.info('✅ Step 3 completed: Actor bootstrap system started');

      // Step 4: Setup event-driven temperature monitoring
      this.logger.info('⚙️ Step 4: Setting up event-driven temperature monitoring');
      await this.setupEventDrivenMonitoring();
      this.logger.info('✅ Step 4 completed: Event-driven monitoring setup');

      this.running = true;

      this.logger.info('🎉 HVAC controller started successfully', {
        actorStatus: this.hvacActor?.getStatus(),
        registeredDomains: this.actorBootstrap.getRegisteredDomains(),
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

    // Stop actor bootstrap system
    this.logger.debug('⚙️ Stopping actor bootstrap system');
    await this.actorBootstrap.stopAll();
    this.logger.debug('✅ Actor bootstrap system stopped');

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
    this.hvacActor = undefined;

    this.logger.info('✅ HVAC controller stopped successfully');
    this.logger.debug('📍 HVACController.stop() EXIT');
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<HVACStatus> {
    this.logger.debug('📍 HVACController.getStatus() ENTRY');
    try {
      const actorStatus = this.hvacActor?.getStatus();
      const haConnected = await this.haClient.connected;

      const status: HVACStatus = {
        controller: {
          running: this.running,
          haConnected: haConnected,
          tempSensor: this.hvacOptions.tempSensor,
          systemMode: this.hvacOptions.systemMode,
          aiEnabled: this.appOptions.useAi,
        },
        stateMachine: {
          currentState: actorStatus?.metadata?.hvacMode as string || 'unknown',
          hvacMode: this.getCurrentHVACMode(),
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
  async triggerEvaluation(): Promise<OperationResult> {
    this.logger.debug('📍 HVACController.triggerEvaluation() ENTRY');
    if (!this.running) {
      this.logger.debug('📍 HVACController.triggerEvaluation() EXIT');
      throw new StateError('HVAC controller is not running');
    }

    try {
      await this.triggerSensorEvents();
      const result = {
        success: true,
        timestamp: new Date().toISOString(),
      };
      this.logger.debug('📍 HVACController.triggerEvaluation() EXIT');
      return result;
    } catch (error) {
      this.logger.error('❌ Manual evaluation failed', error);
      const result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
      this.logger.debug('📍 HVACController.triggerEvaluation() EXIT');
      return result;
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
    
    // Trigger initial reading for all sensors
    await this.triggerSensorEvents();
    this.logger.debug('📍 HVACController.setupEventDrivenMonitoring() EXIT');
  }

  /**
   * Setup event bus subscription for HVAC domain actor
   */
  private setupEventBusSubscription(): void {
    this.logger.debug('📍 HVACController.setupEventBusSubscription() ENTRY');
    if (!this.hvacActor) {
      this.logger.error('❌ Cannot setup event subscription: HVAC actor not available');
      this.logger.debug('📍 HVACController.setupEventBusSubscription() EXIT');
      return;
    }

    this.logger.info('📡 Setting up event bus subscription for HVAC domain actor');

    // Subscribe to HVAC-related events
    this.eventBus.subscribeToEvent('hvac.sensor_states_updated', async (event) => {
      await this.hvacActor!.handleEvent(event);
    });

    this.eventBus.subscribeToEvent('hvac.evaluate_conditions', async (event) => {
      await this.hvacActor!.handleEvent(event);
    });

    this.eventBus.subscribeToEvent('hvac.mode_change_request', async (event) => {
      await this.hvacActor!.handleEvent(event);
    });

    this.logger.info('✅ Event bus subscription setup complete for HVAC domain actor');
    this.logger.debug('📍 HVACController.setupEventBusSubscription() EXIT');
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
   * Handle sensor state changes
   */
  private async handleSensorChange(entityId: string, newState: string): Promise<void> {
    this.logger.debug('📍 HVACController.handleSensorChange() ENTRY');
    try {
      this.logger.debug('📊 Processing sensor change', {
        entityId,
        newState,
        timestamp: new Date().toISOString(),
      });

      // Trigger complete sensor reading for all sensors
      await this.triggerSensorEvents();
    } catch (error) {
      this.logger.error('❌ Failed to handle sensor change', error, {
        entityId,
        newState,
      });
    }
    this.logger.debug('📍 HVACController.handleSensorChange() EXIT');
  }

  /**
   * Trigger events for all sensors
   */
  private async triggerSensorEvents(): Promise<void> {
    this.logger.debug('📍 HVACController.triggerSensorEvents() ENTRY');
    try {
      this.logger.debug('📊 Triggering events for all sensors');

      const sensors = this.getSensors();
      const sensorStates: Record<string, string> = {};

      // Get all sensor readings
      for (const sensorId of sensors) {
        const state = await this.haClient.getState(sensorId);
        sensorStates[sensorId] = state.state;
      }

      // Publish generic sensor state change event
      const stateChangeEvent = new SensorStatesUpdateEvent(sensorStates);
      this.eventBus.publishEvent(stateChangeEvent);

      // Publish evaluation request event
      const evaluationEvent = new EvaluateConditionsEvent();
      this.eventBus.publishEvent(evaluationEvent);

      this.logger.debug('✅ Sensor events published', {
        sensorStates,
        events: [stateChangeEvent.type, evaluationEvent.type],
      });
    } catch (error) {
      this.logger.error(
        '❌ Failed to trigger sensor events',
        error,
      );
    }
    this.logger.debug('📍 HVACController.triggerSensorEvents() EXIT');
  }

  /**
   * Get current HVAC mode from actor
   */
  private getCurrentHVACMode(): HVACMode {
    this.logger.debug('📍 HVACController.getCurrentHVACMode() ENTRY');
    const actorStatus = this.hvacActor?.getStatus();
    const currentState = actorStatus?.metadata?.hvacMode as string;

    switch (currentState) {
      case 'heating':
        this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
        return HVACMode.HEAT;
      case 'cooling':
        this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
        return HVACMode.COOL;
      case 'off':
        this.logger.debug('📍 HVACController.getCurrentHVACMode() EXIT');
        return HVACMode.OFF;
      default:
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

}

