/**
 * HVAC Controller for HAG JavaScript variant.
 *
 * Main orchestrator for HVAC operations using traditional async/await patterns.
 */

import { injectable } from '@needle-di/core';
import { LoggerService } from '../core/logger.ts';
import type { ApplicationOptions, HvacOptions } from '../config/config.ts';
import { HvacActorService } from './hvac-actor-service.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { HassServiceCallImpl } from '../home-assistant/models.ts';
import { HVACMode, HVACStatus, OperationResult } from '../types/common.ts';
import {
  HVACOperationError,
  StateError,
  ValidationError,
} from '../core/exceptions.ts';

/**
 * Interface for AI Agent methods used by controller
 */
export interface HVACAgentInterface {
  getStatusSummary(): Promise<
    { success: boolean; aiSummary?: string; error?: string }
  >;
  manualOverride(
    action: string,
    options: Record<string, unknown>,
  ): Promise<OperationResult>;
  evaluateEfficiency(): Promise<OperationResult>;
  processTemperatureChange(event: {
    entityId: string;
    newState: string;
    oldState?: string;
    timestamp: string;
    attributes?: Record<string, unknown>;
  }): Promise<OperationResult>;
}

@injectable()
export class HVACController {
  private running = false;
  private abortController?: AbortController;

  private hvacOptions: HvacOptions;
  private appOptions: ApplicationOptions;
  private hvacActorService: HvacActorService;
  private haClient: HomeAssistantClient;
  private logger: LoggerService;
  private hvacAgent?: HVACAgentInterface; // Optional AI agent

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    hvacActorService?: HvacActorService,
    haClient?: HomeAssistantClient,
    hvacAgent?: HVACAgentInterface,
  ) {
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.haClient = haClient!;
    this.logger = new LoggerService('HAG.hvac.controller');
    this.hvacAgent = hvacAgent;
    
    // Create HVAC Actor Service with unified XState approach
    this.hvacActorService = new HvacActorService(
      this.hvacOptions,
      this.logger,
      this.haClient
    );
  }

  /**
   * Start the HVAC controller
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warning('🔄 HVAC controller already running', {
        currentState: this.running,
        haConnected: this.haClient?.connected,
      });
      return;
    }

    this.logger.info('🚀 Starting HVAC controller', {
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi,
      hvacEntities: this.hvacOptions.hvacEntities.length,
      tempSensor: this.hvacOptions.tempSensor,
      outdoorSensor: this.hvacOptions.outdoorSensor,
      heatingConfig: {
        temperature: this.hvacOptions.heating.temperature,
        presetMode: this.hvacOptions.heating.presetMode,
        thresholds: this.hvacOptions.heating.temperatureThresholds,
      },
      coolingConfig: {
        temperature: this.hvacOptions.cooling.temperature,
        presetMode: this.hvacOptions.cooling.presetMode,
        thresholds: this.hvacOptions.cooling.temperatureThresholds,
      },
    });

    try {
      // Connect to Home Assistant
      this.logger.info('🔗 Step 1: Connecting to Home Assistant', {
        wsUrl: this.haClient ? 'configured' : 'missing',
        expectedEntities: this.hvacOptions.hvacEntities.map((e) => e.entityId),
      });
      await this.haClient.connect();
      this.logger.info('✅ Step 1 completed: Home Assistant connected');

      // Start actor system
      this.logger.info('⚙️ Step 2: Starting HVAC actor system', {
        initialState: this.hvacActorService?.getCurrentState(),
        systemMode: this.hvacOptions.systemMode,
      });
      this.hvacActorService.start();
      this.logger.info('✅ Step 2 completed: HVAC actor system started', {
        currentState: this.hvacActorService.getCurrentState(),
      });

      // Setup event subscriptions
      this.logger.info('📡 Step 3: Setting up event subscriptions', {
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
      });
      await this.setupEventSubscriptions();
      this.logger.info('✅ Step 3 completed: Event subscriptions configured');

      // Event-driven approach: no monitoring loop needed
      this.logger.info('🔄 Step 4: Pure event-driven mode (Rust HAG pattern)', {
        approach: 'event_only',
        note: 'System responds only to Home Assistant state change events',
      });
      this.abortController = new AbortController();
      this.logger.info('✅ Step 4 completed: Event-driven mode activated');

      // Trigger initial evaluation
      this.logger.info('🎯 Step 5: Triggering initial evaluation', {
        aiEnabled: this.appOptions.useAi,
      });
      await this.triggerInitialEvaluation();
      this.logger.info('✅ Step 5 completed: Initial evaluation triggered');

      this.running = true;
      this.logger.info('🏠 HVAC controller started successfully', {
        systemReady: true,
        mode: this.hvacOptions.systemMode,
        aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
        entities: this.hvacOptions.hvacEntities.length,
        currentState: this.hvacActorService.getCurrentState(),
      });
    } catch (error) {
      this.logger.error('❌ Failed to start HVAC controller', error, {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        haClientConnected: this.haClient?.connected,
        runningState: this.running,
        systemMode: this.hvacOptions.systemMode,
        step: 'startup_sequence',
      });
      await this.stop();
      throw new StateError('Failed to start HVAC controller');
    }
  }

  /**
   * Stop the HVAC controller
   */
  async stop(): Promise<void> {
    this.logger.info('🛑 Stopping HVAC controller', {
      currentlyRunning: this.running,
      currentState: this.hvacActorService?.getCurrentState(),
      haConnected: this.haClient?.connected,
    });

    this.running = false;

    // Event-driven cleanup
    if (this.abortController) {
      this.logger.debug('🔄 Aborting event-driven operations');
      this.abortController.abort();
    }

    // Stop actor system
    this.logger.debug('⚙️ Stopping HVAC actor system', {
      currentState: this.hvacActorService?.getCurrentState(),
    });
    this.hvacActorService.stop();
    this.logger.debug('✅ HVAC actor system stopped');

    // Disconnect from Home Assistant
    try {
      this.logger.debug('🔗 Disconnecting from Home Assistant');
      await this.haClient.disconnect();
      this.logger.debug('✅ Home Assistant disconnected');
    } catch (error) {
      this.logger.warning('⚠️ Error disconnecting from Home Assistant', {
        error,
      });
    }

    this.logger.info('✅ HVAC controller stopped completely', {
      systemShutdown: true,
      finalRunningState: this.running,
    });
  }

  /**
   * Get current system status
   */
  async getStatus(): Promise<HVACStatus> {
    try {
      const actorStatus = this.hvacActorService.getStatus();
      const haConnected = await this.haClient.connected;

      const status: HVACStatus = {
        controller: {
          running: this.running,
          haConnected,
          tempSensor: this.hvacOptions.tempSensor,
          systemMode: this.hvacOptions.systemMode,
          aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
        },
        stateMachine: {
          currentState: actorStatus.mode,
          hvacMode: this.getCurrentHVACMode(),
        },
        timestamp: new Date().toISOString(),
      };

      // Add AI analysis if available
      if (this.appOptions.useAi && this.hvacAgent) {
        try {
          const aiStatus = await this.hvacAgent.getStatusSummary();
          status.aiAnalysis = aiStatus?.success
            ? aiStatus.aiSummary
            : undefined;
        } catch (error) {
          this.logger.warning('Failed to get AI status', { error });
        }
      }

      return status;
    } catch (error) {
      this.logger.error('Failed to get status', error);
      return {
        controller: {
          running: this.running,
          haConnected: false,
          tempSensor: this.hvacOptions.tempSensor,
          systemMode: this.hvacOptions.systemMode,
          aiEnabled: false,
        },
        stateMachine: {
          currentState: 'error',
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Trigger manual evaluation
   */
  async triggerEvaluation(): Promise<OperationResult> {
    this.logger.info('Manual evaluation triggered', {
      aiEnabled: this.appOptions.useAi,
    });

    if (!this.running) {
      throw new StateError('HVAC controller is not running');
    }

    try {
      await this.performEvaluation();

      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Manual evaluation failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Manual HVAC override
   */
  async manualOverride(
    action: string,
    options: Record<string, unknown> = {},
  ): Promise<OperationResult> {
    this.logger.info('🎯 Manual override requested', {
      action,
      options,
      currentState: this.hvacActorService?.getCurrentState(),
      currentMode: this.getCurrentHVACMode(),
      aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
    });
    if (!this.running) {
      this.logger.error(
        '❌ Cannot execute manual override: controller not running',
      );
      throw new StateError('HVAC controller is not running');
    }

    try {
      // Convert action to HVAC mode
      const mode = this.parseHVACMode(action);
      const temperature = options.temperature as number | undefined;

      this.logger.info('🔧 Processing manual override', {
        parsedMode: mode,
        targetTemperature: temperature,
        fromState: this.hvacActorService.getCurrentState(),
        requestedAction: action,
      });

      if (this.appOptions.useAi && this.hvacAgent) {
        // Use AI agent for validation and execution
        this.logger.debug('🤖 Delegating to AI agent for manual override');
        const result = await this.hvacAgent.manualOverride(action, options);

        this.logger.info('✅ AI agent manual override completed', {
          success: result?.success,
          resultData: result,
          mode,
          temperature,
        });

        return {
          success: result?.success ?? false,
          data: result,
          timestamp: new Date().toISOString(),
        };
        } else {
          // Direct execution via actor
          this.logger.info('⚡ Executing manual override via actor', {
            mode,
            temperature,
          });

          // Send manual override to actor
          if (mode === HVACMode.HEAT) {
            this.hvacActorService.setTargetTemperature(temperature || this.hvacOptions.heating.temperature);
          } else if (mode === HVACMode.COOL) {
            this.hvacActorService.setTargetTemperature(temperature || this.hvacOptions.cooling.temperature);
          }

          const newState = this.hvacActorService.getCurrentState();

          this.logger.info('✅ Manual override executed successfully', {
            action,
            mode,
            temperature,
            newState,
          });

          return {
            success: true,
            data: { action, mode, temperature, newState },
            timestamp: new Date().toISOString(),
          };
        }    } catch (error) {
      this.logger.error('❌ Manual override failed', error, {
        action,
        options,
        currentState: this.hvacActorService?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
      throw new HVACOperationError(
        `Manual override failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        action,
      );
    }
  }

  /**
   * Evaluate system efficiency
   */
  async evaluateEfficiency(): Promise<OperationResult> {
    if (!this.running) {
      throw new StateError('HVAC controller is not running');
    }

    try {
      if (this.appOptions.useAi && this.hvacAgent) {
        const result = await this.hvacAgent.evaluateEfficiency();
        return {
          success: result?.success ?? false,
          data: result,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Simple efficiency analysis without AI
        const status = this.hvacActorService.getStatus();
        return {
          success: true,
          data: {
            analysis: `State machine mode: ${status.mode}`,
            recommendations: [
              'Monitor temperature trends',
              'Check for optimal scheduling',
            ],
          },
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.logger.error('Efficiency evaluation failed', error);
      throw new HVACOperationError('Efficiency evaluation failed');
    }
  }

  /**
   * Setup Home Assistant event subscriptions (simplified)
   */
  private async setupEventSubscriptions(): Promise<void> {
    // Subscribe to state change events
    await this.haClient.subscribeEvents('state_changed');

    this.logger.debug('Event subscriptions configured', {
      watchedEntities: [
        this.hvacOptions.tempSensor,
        this.hvacOptions.outdoorSensor,
      ],
    });
  }

  /**
   * Perform periodic HVAC evaluation
   */
  private async performEvaluation(): Promise<void> {
    const evaluationStart = Date.now();

    this.logger.info('🎯 Performing periodic HVAC evaluation', {
      aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
      currentState: this.hvacActorService?.getCurrentState(),
      haConnected: this.haClient?.connected,
      evaluationType: this.appOptions.useAi && this.hvacAgent
        ? 'AI-powered'
        : 'direct',
      startTime: new Date().toISOString(),
    });

    try {
      if (this.appOptions.useAi && this.hvacAgent) {
        // AI-powered evaluation
        this.logger.debug('🤖 Starting AI-powered evaluation');

        const status = await this.hvacAgent.getStatusSummary();

        if (status.success) {
          this.logger.info('✅ AI evaluation completed successfully', {
            hasAiSummary: !!status.aiSummary,
            summaryLength: status.aiSummary?.length,
            summaryPreview: status.aiSummary?.substring(0, 150) +
              (status.aiSummary && status.aiSummary.length > 150 ? '...' : ''),
            evaluationTimeMs: Date.now() - evaluationStart,
          });
        } else {
          this.logger.warning('⚠️ AI evaluation failed', {
            error: status.error,
            fallbackToDirect: true,
            evaluationTimeMs: Date.now() - evaluationStart,
          });

          // Fallback to direct evaluation
          this.logger.debug(
            '🔄 Falling back to direct state machine evaluation',
          );
          await this.evaluateStateMachineDirect();
        }
      } else {
        // Direct state machine evaluation
        this.logger.debug('⚙️ Starting direct state machine evaluation');
        await this.evaluateStateMachineDirect();
      }

      const totalEvaluationTime = Date.now() - evaluationStart;

      this.logger.info('✅ Periodic evaluation completed', {
        evaluationType: this.appOptions.useAi && this.hvacAgent
          ? 'AI'
          : 'direct',
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.hvacActorService?.getCurrentState(),
        success: true,
      });
    } catch (error) {
      const totalEvaluationTime = Date.now() - evaluationStart;

      this.logger.error('❌ Periodic evaluation error', error, {
        evaluationType: this.appOptions.useAi && this.hvacAgent
          ? 'AI'
          : 'direct',
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.hvacActorService?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
    }
  }

  /**
   * Trigger initial evaluation
   */
  private async triggerInitialEvaluation(): Promise<void> {
    this.logger.info('🎯 Triggering initial evaluation', {
      tempSensor: this.hvacOptions.tempSensor,
      aiEnabled: this.appOptions.useAi,
    });

    try {
      // Perform initial evaluation using the actor system
      await this.performEvaluation();
    } catch (error) {
      this.logger.warning('❌ Initial evaluation failed', { error });
    }
  }

  /**
   * Evaluate HVAC system using actor-based approach
   */
  private async evaluateStateMachineDirect(): Promise<void> {
    const evaluationStart = Date.now();

    try {
      this.logger.debug('⚙️ Starting actor-based HVAC evaluation', {
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
        haConnected: this.haClient.connected,
        currentState: this.hvacActorService?.getCurrentState(),
      });

      // Get current temperatures
      this.logger.debug('🌡️ Fetching indoor temperature', {
        sensor: this.hvacOptions.tempSensor,
      });

      const indoorState = await this.haClient.getState(
        this.hvacOptions.tempSensor,
      );
      const indoorTemp = indoorState.getNumericState();

      this.logger.debug('✅ Indoor temperature retrieved', {
        sensor: this.hvacOptions.tempSensor,
        temperature: indoorTemp,
        unit: indoorState.attributes?.unit_of_measurement,
        lastUpdated: indoorState.lastUpdated,
      });

      if (indoorTemp === null) {
        this.logger.warning(
          '⚠️ No indoor temperature available for evaluation',
          {
            sensor: this.hvacOptions.tempSensor,
            state: indoorState.state,
            attributes: indoorState.attributes,
          },
        );
        return;
      }

      this.logger.debug('🌡️ Fetching outdoor temperature', {
        sensor: this.hvacOptions.outdoorSensor,
      });

      const outdoorState = await this.haClient.getState(
        this.hvacOptions.outdoorSensor,
      );
      const outdoorValue = outdoorState.getNumericState();

      if (outdoorValue === null) {
        this.logger.error(
          '❌ Outdoor temperature is null - cannot proceed with evaluation',
          {
            sensor: this.hvacOptions.outdoorSensor,
            state: outdoorState.state,
          },
        );
        return;
      }

      const outdoorTemp = outdoorValue;
      this.logger.debug('✅ Outdoor temperature retrieved', {
        sensor: this.hvacOptions.outdoorSensor,
        temperature: outdoorTemp,
        unit: outdoorState.attributes?.unit_of_measurement,
        lastUpdated: outdoorState.lastUpdated,
      });

      const temperatureFetchTime = Date.now() - evaluationStart;

      this.logger.info('🌡️ Temperature data collected', {
        indoorTemp,
        outdoorTemp,
        temperatureDifference: indoorTemp - outdoorTemp,
        dataFetchTimeMs: temperatureFetchTime,
        thresholds: {
          heating: this.hvacOptions.heating.temperatureThresholds,
          cooling: this.hvacOptions.cooling.temperatureThresholds,
        },
      });

      // Update actor with temperature data - this will trigger state evaluation
      this.logger.debug('⚙️ Updating actor with temperature data');
      this.hvacActorService.updateTemperatures(indoorTemp, outdoorTemp);

      const stateAfterUpdate = this.hvacActorService.getCurrentState();
      this.logger.debug('✅ Actor temperatures updated', {
        newState: stateAfterUpdate,
        temperatures: { indoor: indoorTemp, outdoor: outdoorTemp },
        note: 'Actor will automatically evaluate and transition states based on temperature data',
      });

      const totalEvaluationTime = Date.now() - evaluationStart;

      this.logger.info('✅ Actor-based evaluation completed', {
        indoorTemp,
        outdoorTemp,
        finalState: this.hvacActorService.getCurrentState(),
        evaluationTimeMs: totalEvaluationTime,
        success: true,
      });
    } catch (error) {
      const totalEvaluationTime = Date.now() - evaluationStart;

      this.logger.error('❌ Actor-based evaluation failed', error, {
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.hvacActorService?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown',
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
      });
    }
  }



  /**
   * Get current HVAC mode from state machine
   */
  private getCurrentHVACMode(): HVACMode | undefined {
    const currentState = this.hvacActorService.getCurrentState();

    switch (currentState) {
      case 'heating':
      case 'defrosting':
        return HVACMode.HEAT;
      case 'cooling':
        return HVACMode.COOL;
      case 'idle':
      case 'off':
        return HVACMode.OFF;
      default:
        return undefined;
    }
  }

  /**
   * Parse HVAC mode from string
   */
  private parseHVACMode(action: string): HVACMode {
    switch (action.toLowerCase()) {
      case 'heat':
        return HVACMode.HEAT;
      case 'cool':
        return HVACMode.COOL;
      case 'off':
        return HVACMode.OFF;
      default:
        throw new ValidationError(
          `Invalid HVAC action: ${action}`,
          'action',
          'HVACMode',
          action,
        );
    }
  }
}
