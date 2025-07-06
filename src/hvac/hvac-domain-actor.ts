/**
 * HVAC Domain Actor - implements the generic DomainActor interface
 * Manages HVAC system lifecycle and event handling using the generic actor framework
 */

import { LoggerService } from '../core/logger.ts';
import { BaseEvent } from '../core/event-system.ts';
import { DomainActor, ActorStatus, ActorFactory } from '../core/actor-bootstrap.ts';
import { HVACStateMachine } from './state-machine.ts';
import { HvacActorService } from './hvac-actor-service.ts';
import type { HvacOptions } from '../config/config.ts';
import type { HomeAssistantClient } from '../home-assistant/client.ts';

/**
 * HVAC Domain Actor Configuration
 */
export interface HvacActorConfig {
  hvacOptions: HvacOptions;
  haClient: HomeAssistantClient;
}

/**
 * HVAC Domain Actor - manages HVAC system using generic actor framework
 */
export class HvacDomainActor implements DomainActor {
  readonly name = 'hvac-controller';
  readonly domain = 'hvac';

  private logger: LoggerService;
  private hvacService: HvacActorService;
  private config: HvacActorConfig;
  private status: ActorStatus;

  constructor(config: HvacActorConfig) {
    this.config = config;
    this.logger = new LoggerService('HAG.hvac-domain-actor');
    
    // Create HVAC service with unified XState approach
    this.hvacService = new HvacActorService(
      config.hvacOptions,
      this.logger,
      config.haClient
    );

    this.status = {
      name: this.name,
      domain: this.domain,
      state: 'stopped',
      lastUpdate: new Date(),
      metadata: {
        systemMode: config.hvacOptions.systemMode,
        enabledEntities: config.hvacOptions.hvacEntities.filter(e => e.enabled).length,
        totalEntities: config.hvacOptions.hvacEntities.length,
      },
    };
  }

  /**
   * Start the HVAC domain actor
   */
  async start(): Promise<void> {
    this.logger.info('🎭 Starting HVAC domain actor');
    
    try {
      this.updateStatus('starting');

      // Start the HVAC service
      this.hvacService.start();

      this.updateStatus('running', {
        currentState: this.hvacService.getCurrentState(),
        startedAt: new Date().toISOString(),
      });

      this.logger.info('✅ HVAC domain actor started successfully', {
        currentState: this.hvacService.getCurrentState(),
        systemMode: this.config.hvacOptions.systemMode,
      });
    } catch (error) {
      this.updateStatus('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.logger.error('❌ Failed to start HVAC domain actor', error);
      throw error;
    }
  }

  /**
   * Stop the HVAC domain actor
   */
  async stop(): Promise<void> {
    this.logger.info('🛑 Stopping HVAC domain actor');
    
    try {
      this.updateStatus('stopping');

      // Stop the HVAC service
      this.hvacService.stop();

      this.updateStatus('stopped', {
        stoppedAt: new Date().toISOString(),
      });

      this.logger.info('✅ HVAC domain actor stopped successfully');
    } catch (error) {
      this.updateStatus('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.logger.error('❌ Failed to stop HVAC domain actor', error);
      throw error;
    }
  }

  /**
   * Get current actor status
   */
  getStatus(): ActorStatus {
    // Merge with current HVAC service status
    const hvacStatus = this.hvacService.getStatus();
    
    return {
      ...this.status,
      metadata: {
        ...this.status.metadata,
        hvacMode: hvacStatus.mode,
        isActive: hvacStatus.isActive,
        temperatures: hvacStatus.temperatures,
      },
    };
  }

  /**
   * Handle domain-specific events
   */
  async handleEvent(event: BaseEvent): Promise<void> {
    this.logger.debug('📨 Handling event', {
      type: event.type,
      timestamp: event.timestamp,
    });

    try {
      switch (event.type) {
        case 'hvac.temperature_update':
          await this.handleTemperatureUpdate(event);
          break;
        
        case 'hvac.mode_change_request':
          await this.handleModeChangeRequest(event);
          break;
        
        case 'hvac.evaluate_conditions':
          await this.handleEvaluateConditions(event);
          break;
        
        case 'system.shutdown':
          await this.handleSystemShutdown(event);
          break;
        
        default:
          this.logger.debug('🤷 Unhandled event type', { type: event.type });
      }
    } catch (error) {
      this.logger.error('❌ Error handling event', error, {
        eventType: event.type,
      });
    }
  }

  /**
   * Handle temperature update events
   */
  private async handleTemperatureUpdate(event: BaseEvent): Promise<void> {
    const payload = event.payload as { indoor: number; outdoor: number };
    
    this.logger.info('🌡️ Processing temperature update', {
      indoor: payload.indoor,
      outdoor: payload.outdoor,
    });

    this.hvacService.updateTemperatures(payload.indoor, payload.outdoor);
    
    this.updateStatus('running', {
      lastTemperatureUpdate: new Date().toISOString(),
      currentTemperatures: payload,
    });
  }

  /**
   * Handle mode change requests
   */
  private async handleModeChangeRequest(event: BaseEvent): Promise<void> {
    const payload = event.payload as { mode: string; temperature?: number };
    
    this.logger.info('🎛️ Processing mode change request', {
      mode: payload.mode,
      temperature: payload.temperature,
    });

    // Set target temperature if provided
    if (payload.temperature) {
      this.hvacService.setTargetTemperature(payload.temperature);
    }

    this.updateStatus('running', {
      lastModeChange: new Date().toISOString(),
      requestedMode: payload.mode,
    });
  }

  /**
   * Handle condition evaluation requests
   */
  private async handleEvaluateConditions(event: BaseEvent): Promise<void> {
    this.logger.info('🔍 Processing condition evaluation request');

    // The HVAC service automatically evaluates conditions when temperatures are updated
    // This event can trigger a manual evaluation if needed
    const currentState = this.hvacService.getCurrentState();
    
    this.updateStatus('running', {
      lastEvaluation: new Date().toISOString(),
      currentState,
    });
  }

  /**
   * Handle system shutdown events
   */
  private async handleSystemShutdown(event: BaseEvent): Promise<void> {
    const payload = event.payload as { reason: string };
    
    this.logger.info('🛑 Processing system shutdown', {
      reason: payload.reason,
    });

    await this.stop();
  }

  /**
   * Update actor status
   */
  private updateStatus(
    state: ActorStatus['state'],
    additionalMetadata?: Record<string, unknown>
  ): void {
    this.status = {
      ...this.status,
      state,
      lastUpdate: new Date(),
      metadata: additionalMetadata 
        ? { ...this.status.metadata, ...additionalMetadata }
        : this.status.metadata,
    };
  }

  /**
   * Get HVAC service for direct access (if needed)
   */
  getHvacService(): HvacActorService {
    return this.hvacService;
  }
}

/**
 * HVAC Actor Factory - creates HVAC domain actors
 */
export class HvacActorFactory implements ActorFactory<HvacDomainActor> {
  readonly domain = 'hvac';

  create(config: unknown): HvacDomainActor {
    const hvacConfig = config as HvacActorConfig;
    return new HvacDomainActor(hvacConfig);
  }

  validateConfig(config: unknown): boolean {
    const hvacConfig = config as HvacActorConfig;
    
    // Basic validation
    return !!(
      hvacConfig &&
      hvacConfig.hvacOptions &&
      hvacConfig.haClient &&
      hvacConfig.hvacOptions.tempSensor &&
      hvacConfig.hvacOptions.outdoorSensor &&
      hvacConfig.hvacOptions.hvacEntities &&
      Array.isArray(hvacConfig.hvacOptions.hvacEntities)
    );
  }
}