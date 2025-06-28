/**
 * HVAC Controller for HAG JavaScript variant.
 * 
 * Main orchestrator for HVAC operations using traditional async/await patterns.
 */

import { injectable } from '@needle-di/core';
import { delay } from '@std/async';
import { LoggerService } from '../core/logger.ts';
import type { HvacOptions, ApplicationOptions } from '../config/config.ts';
import { HVACStateMachine } from './state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { HassEventImpl, HassServiceCallImpl } from '../home-assistant/models.ts';
import { HVACStatus, HVACMode, OperationResult, HassStateChangeData } from '../types/common.ts';
import { StateError, HVACOperationError, ValidationError } from '../core/exceptions.ts';

/**
 * Interface for AI Agent methods used by controller
 */
export interface HVACAgentInterface {
  getStatusSummary(): Promise<{ success: boolean; aiSummary?: string; error?: string }>;
  manualOverride(action: string, options: Record<string, unknown>): Promise<OperationResult>;
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
  private monitoringTask?: Promise<void>;
  private abortController?: AbortController;

  private hvacOptions: HvacOptions;
  private appOptions: ApplicationOptions;
  private stateMachine: HVACStateMachine;
  private haClient: HomeAssistantClient;
  private logger: LoggerService;
  private hvacAgent?: HVACAgentInterface; // Optional AI agent

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    stateMachine?: HVACStateMachine,
    haClient?: HomeAssistantClient,
    logger?: LoggerService,
    hvacAgent?: HVACAgentInterface,
  ) {
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.stateMachine = stateMachine!;
    this.haClient = haClient!;
    this.logger = logger!;
    this.hvacAgent = hvacAgent;
  }

  /**
   * Start the HVAC controller
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warning('HVAC controller already running');
      return;
    }

    this.logger.info('Starting HVAC controller', {
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi,
      entities: this.hvacOptions.hvacEntities.length,
    });

    try {
      // Connect to Home Assistant
      this.logger.debug('Step 1: Connecting to Home Assistant...');
      await this.haClient.connect();
      this.logger.debug('✅ Step 1 completed: Home Assistant connected');

      // Start state machine
      this.logger.debug('Step 2: Starting state machine...');
      this.stateMachine.start();
      this.logger.debug('✅ Step 2 completed: State machine started');

      // Setup event subscriptions
      this.logger.debug('Step 3: Setting up event subscriptions...');
      await this.setupEventSubscriptions();
      this.logger.debug('✅ Step 3 completed: Event subscriptions set up');

      // Start monitoring loop
      this.logger.debug('Step 4: Starting monitoring loop...');
      this.abortController = new AbortController();
      this.monitoringTask = this.monitoringLoop();
      this.logger.debug('✅ Step 4 completed: Monitoring loop started');

      // Trigger initial evaluation
      this.logger.debug('Step 5: Triggering initial evaluation...');
      await this.triggerInitialEvaluation();
      this.logger.debug('✅ Step 5 completed: Initial evaluation triggered');

      this.running = true;
      this.logger.info('✅ HVAC controller started successfully');

    } catch (error) {
      this.logger.error('Failed to start HVAC controller', error);
      this.logger.debug('Controller startup failed, details:', {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        haClientConnected: this.haClient?.connected,
        runningState: this.running,
      });
      await this.stop();
      throw new StateError('Failed to start HVAC controller');
    }
  }

  /**
   * Stop the HVAC controller
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping HVAC controller');

    this.running = false;

    // Cancel monitoring loop
    if (this.abortController) {
      this.abortController.abort();
    }

    // Wait for monitoring task to complete
    if (this.monitoringTask) {
      try {
        await this.monitoringTask;
      } catch (error) {
        // Ignore cancellation errors
        if (error instanceof Error && error.name !== 'AbortError') {
          this.logger.error('Error stopping monitoring task', error);
        }
      }
    }

    // Stop state machine
    this.stateMachine.stop();

    // Disconnect from Home Assistant
    try {
      await this.haClient.disconnect();
    } catch (error) {
      this.logger.warning('Error disconnecting from Home Assistant', { error });
    }

    this.logger.info('✅ HVAC controller stopped');
  }

  /**
   * Get current system status
   */
  async getStatus(): Promise<HVACStatus> {
    try {
      const stateMachineStatus = this.stateMachine.getStatus();
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
          currentState: stateMachineStatus.currentState,
          hvacMode: this.getCurrentHVACMode(),
          conditions: stateMachineStatus.context,
        },
        timestamp: new Date().toISOString(),
      };

      // Add AI analysis if available
      if (this.appOptions.useAi && this.hvacAgent) {
        try {
          const aiStatus = await this.hvacAgent.getStatusSummary();
          status.aiAnalysis = aiStatus?.success ? aiStatus.aiSummary : undefined;
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
  async manualOverride(action: string, options: Record<string, unknown> = {}): Promise<OperationResult> {
    this.logger.info('Manual override requested', { action, options });

    if (!this.running) {
      throw new StateError('HVAC controller is not running');
    }

    try {
      // Convert action to HVAC mode
      const mode = this.parseHVACMode(action);
      const temperature = options.temperature as number | undefined;

      if (this.appOptions.useAi && this.hvacAgent) {
        // Use AI agent for validation and execution
        const result = await this.hvacAgent.manualOverride(action, options);
        return {
          success: result?.success ?? false,
          data: result,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Direct execution
        await this.executeHVACMode(mode, temperature);
        this.stateMachine.manualOverride(mode, temperature);

        return {
          success: true,
          data: { action, mode, temperature },
          timestamp: new Date().toISOString(),
        };
      }

    } catch (error) {
      this.logger.error('Manual override failed', error);
      throw new HVACOperationError(
        `Manual override failed: ${error instanceof Error ? error.message : String(error)}`,
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
        const status = this.stateMachine.getStatus();
        return {
          success: true,
          data: {
            analysis: `State machine mode: ${status.currentState}`,
            recommendations: ['Monitor temperature trends', 'Check for optimal scheduling'],
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
   * Setup Home Assistant event subscriptions
   */
  private async setupEventSubscriptions(): Promise<void> {
    // Subscribe to state change events
    await this.haClient.subscribeEvents('state_changed');

    // Add event handler for temperature sensor changes
    this.haClient.addEventHandler('state_changed', this.handleStateChange.bind(this));

    this.logger.debug('Event subscriptions configured', {
      tempSensor: this.hvacOptions.tempSensor,
    });
  }

  /**
   * Handle Home Assistant state change events
   */
  private async handleStateChange(event: HassEventImpl): Promise<void> {
    this.logger.debug('Received state change event', {
      eventType: event.eventType,
    });

    if (!event.isStateChanged()) {
      return;
    }

    const stateChange = event.getStateChangeData();
    if (!stateChange || stateChange.entityId !== this.hvacOptions.tempSensor) {
      return;
    }

    if (!stateChange.newState) {
      this.logger.warning('Temperature sensor state change with no new state', {
        entityId: stateChange.entityId,
      });
      return;
    }

    this.logger.debug('Processing temperature sensor change', {
      entityId: stateChange.entityId,
      oldState: stateChange.oldState?.state,
      newState: stateChange.newState.state,
    });

    try {
      if (this.appOptions.useAi && this.hvacAgent) {
        // Process through AI agent
        const eventData = {
          entityId: stateChange.entityId,
          newState: stateChange.newState.state,
          oldState: stateChange.oldState?.state,
          timestamp: event.timeFired.toISOString(),
          attributes: stateChange.newState.attributes,
        };

        await this.hvacAgent.processTemperatureChange(eventData);
      } else {
        // Use direct state machine logic
        await this.processStateChangeDirect(stateChange);
      }

    } catch (error) {
      this.logger.error('Failed to process temperature change', error);
    }
  }

  /**
   * Process state change using direct state machine logic
   */
  private async processStateChangeDirect(stateChange: HassStateChangeData): Promise<void> {
    try {
      const newTemp = parseFloat(stateChange?.newState?.state || '0');
      if (isNaN(newTemp)) {
        this.logger.warning('Invalid temperature value', {
          entityId: stateChange?.entityId,
          state: stateChange?.newState?.state,
        });
        return;
      }

      // Get outdoor temperature
      let outdoorTemp = 20.0; // Default fallback
      try {
        const outdoorState = await this.haClient.getState(this.hvacOptions.outdoorSensor);
        const outdoorValue = outdoorState.getNumericState();
        if (outdoorValue !== null) {
          outdoorTemp = outdoorValue;
        }
      } catch (error) {
        this.logger.warning('Failed to get outdoor temperature', { error });
      }

      // Update state machine with new conditions
      this.stateMachine.updateTemperatures(newTemp, outdoorTemp);

      // Trigger evaluation
      await this.evaluateAndExecute();

    } catch (error) {
      this.logger.error('Direct state change processing failed', error);
    }
  }

  /**
   * Monitoring loop for periodic evaluation
   */
  private async monitoringLoop(): Promise<void> {
    const interval = 300000; // 5 minutes
    
    this.logger.info('Starting HVAC monitoring loop');

    try {
      while (!this.abortController?.signal.aborted) {
        try {
          await this.performEvaluation();
          await delay(interval);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            break;
          }
          this.logger.error('Error in monitoring loop', error);
          await delay(60000); // Wait 1 minute before retry
        }
      }
    } catch (error) {
      this.logger.error('Monitoring loop failed', error);
    } finally {
      this.logger.info('Monitoring loop stopped');
    }
  }

  /**
   * Perform periodic HVAC evaluation
   */
  private async performEvaluation(): Promise<void> {
    this.logger.debug('Performing periodic HVAC evaluation', {
      aiEnabled: this.appOptions.useAi,
    });

    try {
      if (this.appOptions.useAi && this.hvacAgent) {
        // AI-powered evaluation
        const status = await this.hvacAgent.getStatusSummary();
        if (status.success) {
          this.logger.debug('AI evaluation completed', {
            summary: status.aiSummary?.substring(0, 100),
          });
        } else {
          this.logger.warning('AI evaluation failed', { error: status.error });
        }
      } else {
        // Direct state machine evaluation
        await this.evaluateStateMachineDirect();
      }
    } catch (error) {
      this.logger.error('Periodic evaluation error', error);
    }
  }

  /**
   * Trigger initial evaluation on startup
   */
  private async triggerInitialEvaluation(): Promise<void> {
    this.logger.info('Triggering initial HVAC evaluation');

    try {
      if (this.appOptions.useAi && this.hvacAgent) {
        const initialEvent = {
          entityId: this.hvacOptions.tempSensor,
          newState: 'initial_check',
          oldState: undefined,
          timestamp: new Date().toISOString(),
        };

        await this.hvacAgent.processTemperatureChange(initialEvent);
      } else {
        await this.evaluateStateMachineDirect();
      }
    } catch (error) {
      this.logger.warning('Initial evaluation failed', { error });
    }
  }

  /**
   * Evaluate state machine directly without AI
   */
  private async evaluateStateMachineDirect(): Promise<void> {
    try {
      // Get current temperatures
      this.logger.debug('Getting indoor temperature state', {
        sensor: this.hvacOptions.tempSensor,
        haConnected: this.haClient.connected,
      });
      
      const indoorState = await this.haClient.getState(this.hvacOptions.tempSensor);
      const indoorTemp = indoorState.getNumericState();

      if (indoorTemp === null) {
        this.logger.warning('No indoor temperature available for evaluation');
        return;
      }

      let outdoorTemp = 20.0;
      try {
        const outdoorState = await this.haClient.getState(this.hvacOptions.outdoorSensor);
        const outdoorValue = outdoorState.getNumericState();
        if (outdoorValue !== null) {
          outdoorTemp = outdoorValue;
        }
      } catch (error) {
        this.logger.warning('Failed to get outdoor temperature', { error });
      }

      // Update state machine conditions
      this.stateMachine.updateTemperatures(indoorTemp, outdoorTemp);

      // Evaluate and execute actions
      await this.evaluateAndExecute();

    } catch (error) {
      this.logger.error('Direct state machine evaluation failed', error);
    }
  }

  /**
   * Evaluate state machine and execute HVAC actions
   */
  private async evaluateAndExecute(): Promise<void> {
    const previousState = this.stateMachine.getCurrentState();
    
    // Trigger evaluation
    this.stateMachine.evaluateConditions();
    
    const currentState = this.stateMachine.getCurrentState();
    const hvacMode = this.getCurrentHVACMode();

    this.logger.info('State machine evaluation completed', {
      previousState,
      currentState,
      hvacMode,
      stateChanged: previousState !== currentState,
    });

    // Execute HVAC actions if mode changed or manual override
    if (hvacMode && (previousState !== currentState || currentState === 'manualOverride')) {
      await this.executeHVACMode(hvacMode);
    }
  }

  /**
   * Execute HVAC mode changes on actual devices
   */
  private async executeHVACMode(hvacMode: HVACMode, targetTemp?: number): Promise<void> {
    this.logger.info('Executing HVAC mode change', { hvacMode, targetTemp });

    // Get enabled entities
    const enabledEntities = this.hvacOptions.hvacEntities.filter(entity => entity.enabled);

    if (enabledEntities.length === 0) {
      this.logger.warning('No enabled HVAC entities found');
      return;
    }

    // Execute mode change for each entity
    for (const entity of enabledEntities) {
      try {
        await this.controlHVACEntity(entity.entityId, hvacMode, targetTemp);
        
        this.logger.info('HVAC entity controlled successfully', {
          entityId: entity.entityId,
          mode: hvacMode,
          temperature: targetTemp,
        });

      } catch (error) {
        this.logger.error('Failed to control HVAC entity', {
          entityId: entity.entityId,
          mode: hvacMode,
          error,
        });
      }
    }
  }

  /**
   * Control individual HVAC entity
   */
  private async controlHVACEntity(entityId: string, mode: HVACMode, targetTemp?: number): Promise<void> {
    // Set HVAC mode
    const modeCall = HassServiceCallImpl.climate('set_hvac_mode', entityId, { hvac_mode: mode });
    await this.haClient.callService(modeCall);

    // Set temperature and preset if not turning off
    if (mode !== HVACMode.OFF) {
      const temperature = targetTemp || (mode === HVACMode.HEAT 
        ? this.hvacOptions.heating.temperature 
        : this.hvacOptions.cooling.temperature);

      const tempCall = HassServiceCallImpl.climate('set_temperature', entityId, { temperature });
      await this.haClient.callService(tempCall);

      const presetMode = mode === HVACMode.HEAT 
        ? this.hvacOptions.heating.presetMode 
        : this.hvacOptions.cooling.presetMode;

      const presetCall = HassServiceCallImpl.climate('set_preset_mode', entityId, { preset_mode: presetMode });
      await this.haClient.callService(presetCall);
    }
  }

  /**
   * Get current HVAC mode from state machine
   */
  private getCurrentHVACMode(): HVACMode | undefined {
    const currentState = this.stateMachine.getCurrentState();
    
    switch (currentState) {
      case 'heating':
      case 'defrosting':
        return HVACMode.HEAT;
      case 'cooling':
        return HVACMode.COOL;
      case 'idle':
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
        throw new ValidationError(`Invalid HVAC action: ${action}`, 'action', 'HVACMode', action);
    }
  }
}