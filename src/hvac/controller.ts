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
 * Temperature update event
 */
class TemperatureUpdateEvent extends AppEvent {
  constructor(indoor: number, outdoor: number) {
    super('hvac.temperature_update', { indoor, outdoor });
  }
}

/**
 * Mode change request event
 */
class ModeChangeRequestEvent extends AppEvent {
  constructor(mode: string, temperature?: number) {
    super('hvac.mode_change_request', { mode, temperature });
  }
}

/**
 * Condition evaluation request event
 */
class EvaluateConditionsEvent extends AppEvent {
  constructor() {
    super('hvac.evaluate_conditions', {});
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
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.haClient = haClient!;
    this.actorBootstrap = actorBootstrap!;
    this.eventBus = eventBus!;
    this.logger = new LoggerService('HAG.hvac.controller-v2');
  }

  /**
   * Start the HVAC controller using actor bootstrap
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warning('🔄 HVAC controller already running');
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

      // Step 4: Start monitoring loop
      this.logger.info('⚙️ Step 4: Starting monitoring loop');
      this.startMonitoringLoop();
      this.logger.info('✅ Step 4 completed: Monitoring loop started');

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
  }

  /**
   * Stop the HVAC controller
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.logger.warning('⚠️ HVAC controller not running');
      return;
    }

    this.logger.info('🛑 Stopping HVAC controller');

    // Stop monitoring loop
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
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<HVACStatus> {
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

      return status;
    } catch (error) {
      this.logger.error('❌ Failed to get status', error);
      throw new StateError('Failed to get HVAC status');
    }
  }

  /**
   * Trigger manual evaluation
   */
  async triggerEvaluation(): Promise<OperationResult> {
    if (!this.running) {
      throw new StateError('HVAC controller is not running');
    }

    try {
      await this.evaluateAndPublishTemperatures();
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

      return {
        success: true,
        data: { action, mode, temperature, eventPublished: true },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('❌ Manual override failed', error, {
        action,
        options,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Start monitoring loop with event-driven temperature updates
   */
  private startMonitoringLoop(): void {
    const monitoringInterval = setInterval(async () => {
      if (this.abortController?.signal.aborted) {
        clearInterval(monitoringInterval);
        return;
      }

      try {
        await this.evaluateAndPublishTemperatures();
      } catch (error) {
        this.logger.error('❌ Monitoring loop error', error);
      }
    }, 30000); // 30 seconds

    // Handle abort signal
    this.abortController?.signal.addEventListener('abort', () => {
      clearInterval(monitoringInterval);
      this.logger.debug('🛑 Monitoring loop stopped');
    });

    this.logger.debug('🔄 Monitoring loop started (30s interval)');
  }

  /**
   * Evaluate temperatures and publish update events
   */
  private async evaluateAndPublishTemperatures(): Promise<void> {
    try {
      this.logger.debug('🌡️ Evaluating temperatures for event publication');

      // Get temperature readings
      const indoorTempState = await this.haClient.getState(
        this.hvacOptions.tempSensor,
      );
      const outdoorTempState = await this.haClient.getState(
        this.hvacOptions.outdoorSensor,
      );

      const indoorTemp = parseFloat(indoorTempState.state);
      const outdoorTemp = parseFloat(outdoorTempState.state);

      if (isNaN(indoorTemp) || isNaN(outdoorTemp)) {
        this.logger.warning('⚠️ Invalid temperature readings', {
          indoor: indoorTempState.state,
          outdoor: outdoorTempState.state,
        });
        return;
      }

      // Publish temperature update event
      const temperatureEvent = new TemperatureUpdateEvent(
        indoorTemp,
        outdoorTemp,
      );
      this.eventBus.publishEvent(temperatureEvent);

      // Publish evaluation request event
      const evaluationEvent = new EvaluateConditionsEvent();
      this.eventBus.publishEvent(evaluationEvent);

      this.logger.debug('✅ Temperature events published', {
        indoor: indoorTemp,
        outdoor: outdoorTemp,
        events: [temperatureEvent.type, evaluationEvent.type],
      });
    } catch (error) {
      this.logger.error(
        '❌ Failed to evaluate and publish temperatures',
        error,
      );
    }
  }

  /**
   * Get current HVAC mode from actor
   */
  private getCurrentHVACMode(): HVACMode {
    const actorStatus = this.hvacActor?.getStatus();
    const currentState = actorStatus?.metadata?.hvacMode as string;

    switch (currentState) {
      case 'heating':
        return HVACMode.HEAT;
      case 'cooling':
        return HVACMode.COOL;
      case 'off':
        return HVACMode.OFF;
      default:
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
   * Get actor bootstrap system (for debugging/monitoring)
   */
  getActorBootstrap(): ActorBootstrap {
    return this.actorBootstrap;
  }

  /**
   * Get HVAC actor (for direct access if needed)
   */
  getHvacActor(): HvacDomainActor | undefined {
    return this.hvacActor;
  }
}

