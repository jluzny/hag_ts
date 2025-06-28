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
    hvacAgent?: HVACAgentInterface,
  ) {
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.stateMachine = stateMachine!;
    this.haClient = haClient!;
    this.logger = new LoggerService('HAG.hvac.controller');
    this.hvacAgent = hvacAgent;
  }

  /**
   * Start the HVAC controller
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warning('🔄 HVAC controller already running', {
        currentState: this.running,
        haConnected: this.haClient?.connected
      });
      return;
    }

    this.logger.info('🚀 Starting HVAC controller', {
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi,
      dryRun: this.appOptions.dryRun,
      hvacEntities: this.hvacOptions.hvacEntities.length,
      tempSensor: this.hvacOptions.tempSensor,
      outdoorSensor: this.hvacOptions.outdoorSensor,
      heatingConfig: {
        temperature: this.hvacOptions.heating.temperature,
        presetMode: this.hvacOptions.heating.presetMode,
        thresholds: this.hvacOptions.heating.temperatureThresholds
      },
      coolingConfig: {
        temperature: this.hvacOptions.cooling.temperature,
        presetMode: this.hvacOptions.cooling.presetMode,
        thresholds: this.hvacOptions.cooling.temperatureThresholds
      }
    });

    try {
      // Connect to Home Assistant
      this.logger.info('🔗 Step 1: Connecting to Home Assistant', {
        wsUrl: this.haClient ? 'configured' : 'missing',
        expectedEntities: this.hvacOptions.hvacEntities.map(e => e.entityId)
      });
      await this.haClient.connect();
      this.logger.info('✅ Step 1 completed: Home Assistant connected');

      // Start state machine
      this.logger.info('⚙️ Step 2: Starting state machine', {
        initialState: this.stateMachine?.getCurrentState(),
        systemMode: this.hvacOptions.systemMode
      });
      this.stateMachine.start();
      this.logger.info('✅ Step 2 completed: State machine started', {
        currentState: this.stateMachine.getCurrentState()
      });

      // Setup event subscriptions
      this.logger.info('📡 Step 3: Setting up event subscriptions', {
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor
      });
      await this.setupEventSubscriptions();
      this.logger.info('✅ Step 3 completed: Event subscriptions configured');

      // Start monitoring loop
      this.logger.info('🔄 Step 4: Starting monitoring loop', {
        monitoringInterval: '5 minutes',
        periodicEvaluation: true
      });
      this.abortController = new AbortController();
      this.monitoringTask = this.monitoringLoop();
      this.logger.info('✅ Step 4 completed: Monitoring loop started');

      // Trigger initial evaluation
      this.logger.info('🎯 Step 5: Triggering initial evaluation', {
        aiEnabled: this.appOptions.useAi,
        dryRun: this.appOptions.dryRun
      });
      await this.triggerInitialEvaluation();
      this.logger.info('✅ Step 5 completed: Initial evaluation triggered');

      this.running = true;
      this.logger.info('🏠 HVAC controller started successfully', {
        systemReady: true,
        mode: this.hvacOptions.systemMode,
        aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
        entities: this.hvacOptions.hvacEntities.length,
        currentState: this.stateMachine.getCurrentState()
      });

    } catch (error) {
      this.logger.error('❌ Failed to start HVAC controller', error, {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        haClientConnected: this.haClient?.connected,
        runningState: this.running,
        systemMode: this.hvacOptions.systemMode,
        step: 'startup_sequence'
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
      currentState: this.stateMachine?.getCurrentState(),
      haConnected: this.haClient?.connected
    });

    this.running = false;

    // Cancel monitoring loop
    if (this.abortController) {
      this.logger.debug('🔄 Aborting monitoring loop');
      this.abortController.abort();
    }

    // Wait for monitoring task to complete
    if (this.monitoringTask) {
      try {
        this.logger.debug('⏳ Waiting for monitoring task to complete');
        await this.monitoringTask;
        this.logger.debug('✅ Monitoring task completed');
      } catch (error) {
        // Ignore cancellation errors
        if (error instanceof Error && error.name !== 'AbortError') {
          this.logger.error('❌ Error stopping monitoring task', error);
        } else {
          this.logger.debug('✅ Monitoring task aborted successfully');
        }
      }
    }

    // Stop state machine
    this.logger.debug('⚙️ Stopping state machine', {
      currentState: this.stateMachine?.getCurrentState()
    });
    this.stateMachine.stop();
    this.logger.debug('✅ State machine stopped');

    // Disconnect from Home Assistant
    try {
      this.logger.debug('🔗 Disconnecting from Home Assistant');
      await this.haClient.disconnect();
      this.logger.debug('✅ Home Assistant disconnected');
    } catch (error) {
      this.logger.warning('⚠️ Error disconnecting from Home Assistant', { error });
    }

    this.logger.info('✅ HVAC controller stopped completely', {
      systemShutdown: true,
      finalRunningState: this.running
    });
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
    this.logger.info('🎯 Manual override requested', {
      action,
      options,
      currentState: this.stateMachine?.getCurrentState(),
      currentMode: this.getCurrentHVACMode(),
      aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
      dryRun: this.appOptions.dryRun
    });

    if (!this.running) {
      this.logger.error('❌ Cannot execute manual override: controller not running');
      throw new StateError('HVAC controller is not running');
    }

    try {
      // Convert action to HVAC mode
      const mode = this.parseHVACMode(action);
      const temperature = options.temperature as number | undefined;
      
      this.logger.info('🔧 Processing manual override', {
        parsedMode: mode,
        targetTemperature: temperature,
        fromState: this.stateMachine.getCurrentState(),
        requestedAction: action
      });

      if (this.appOptions.useAi && this.hvacAgent) {
        // Use AI agent for validation and execution
        this.logger.debug('🤖 Delegating to AI agent for manual override');
        const result = await this.hvacAgent.manualOverride(action, options);
        
        this.logger.info('✅ AI agent manual override completed', {
          success: result?.success,
          resultData: result,
          mode,
          temperature
        });
        
        return {
          success: result?.success ?? false,
          data: result,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Direct execution
        this.logger.info('⚡ Executing direct manual override', {
          mode,
          temperature,
          dryRun: this.appOptions.dryRun
        });
        
        await this.executeHVACMode(mode, temperature);
        this.stateMachine.manualOverride(mode, temperature);
        
        const newState = this.stateMachine.getCurrentState();
        
        this.logger.info('✅ Manual override executed successfully', {
          action,
          mode,
          temperature,
          newState,
          dryRun: this.appOptions.dryRun
        });

        return {
          success: true,
          data: { action, mode, temperature, newState },
          timestamp: new Date().toISOString(),
        };
      }

    } catch (error) {
      this.logger.error('❌ Manual override failed', error, {
        action,
        options,
        currentState: this.stateMachine?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
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
    this.logger.debug('📨 Received state change event', {
      eventType: event.eventType,
      timeFired: event.timeFired,
      origin: event.origin
    });

    if (!event.isStateChanged()) {
      this.logger.debug('🔍 Event is not a state change, ignoring');
      return;
    }

    const stateChange = event.getStateChangeData();
    if (!stateChange) {
      this.logger.debug('🔍 No state change data available, ignoring');
      return;
    }
    
    // Log all state changes for debugging, but only process temperature sensor
    this.logger.debug('🔄 Entity state changed', {
      entityId: stateChange.entityId,
      oldState: stateChange.oldState?.state,
      newState: stateChange.newState?.state,
      isTemperatureSensor: stateChange.entityId === this.hvacOptions.tempSensor,
      isOutdoorSensor: stateChange.entityId === this.hvacOptions.outdoorSensor
    });
    
    if (stateChange.entityId !== this.hvacOptions.tempSensor) {
      return;
    }

    if (!stateChange.newState) {
      this.logger.warning('⚠️ Temperature sensor state change with no new state', {
        entityId: stateChange.entityId,
        oldState: stateChange.oldState?.state
      });
      return;
    }

    this.logger.info('🌡️ Processing temperature sensor change', {
      entityId: stateChange.entityId,
      oldTemperature: stateChange.oldState?.state,
      newTemperature: stateChange.newState.state,
      temperatureChange: stateChange.oldState?.state && stateChange.newState?.state 
        ? parseFloat(stateChange.newState.state) - parseFloat(stateChange.oldState.state)
        : 'unknown',
      currentHVACState: this.stateMachine?.getCurrentState(),
      lastChanged: stateChange.newState.lastChanged,
      attributes: stateChange.newState.attributes
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
        
        this.logger.debug('🤖 Delegating temperature change to AI agent', {
          eventData,
          aiAgentAvailable: !!this.hvacAgent
        });

        await this.hvacAgent.processTemperatureChange(eventData);
        
        this.logger.debug('✅ AI agent processed temperature change');
      } else {
        // Use direct state machine logic
        this.logger.debug('⚙️ Processing temperature change with direct state machine logic');
        await this.processStateChangeDirect(stateChange);
        this.logger.debug('✅ Direct state machine processing completed');
      }

    } catch (error) {
      this.logger.error('❌ Failed to process temperature change', error, {
        entityId: stateChange.entityId,
        newTemperature: stateChange.newState?.state,
        oldTemperature: stateChange.oldState?.state,
        processingMethod: this.appOptions.useAi && this.hvacAgent ? 'AI' : 'direct'
      });
    }
  }

  /**
   * Process state change using direct state machine logic
   */
  private async processStateChangeDirect(stateChange: HassStateChangeData): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🔄 Starting direct state change processing', {
        entityId: stateChange?.entityId,
        rawState: stateChange?.newState?.state,
        processingStartTime: new Date().toISOString()
      });
      
      const newTemp = parseFloat(stateChange?.newState?.state || '0');
      if (isNaN(newTemp)) {
        this.logger.warning('⚠️ Invalid temperature value received', {
          entityId: stateChange?.entityId,
          rawState: stateChange?.newState?.state,
          parsedValue: newTemp,
          stateType: typeof stateChange?.newState?.state
        });
        return;
      }
      
      this.logger.debug('✅ Temperature parsed successfully', {
        entityId: stateChange?.entityId,
        parsedTemperature: newTemp,
        unit: stateChange?.newState?.attributes?.unit_of_measurement || 'unknown'
      });

      // Get outdoor temperature
      let outdoorTemp = 20.0; // Default fallback
      try {
        this.logger.debug('🌡️ Fetching outdoor temperature', {
          outdoorSensor: this.hvacOptions.outdoorSensor
        });
        
        const outdoorState = await this.haClient.getState(this.hvacOptions.outdoorSensor);
        const outdoorValue = outdoorState.getNumericState();
        
        if (outdoorValue !== null) {
          outdoorTemp = outdoorValue;
          this.logger.debug('✅ Outdoor temperature retrieved', {
            outdoorTemperature: outdoorTemp,
            outdoorSensor: this.hvacOptions.outdoorSensor,
            unit: outdoorState.attributes?.unit_of_measurement
          });
        } else {
          this.logger.warning('⚠️ Outdoor temperature is null, using fallback', {
            fallbackTemp: outdoorTemp,
            outdoorSensor: this.hvacOptions.outdoorSensor
          });
        }
      } catch (error) {
        this.logger.warning('⚠️ Failed to get outdoor temperature, using fallback', {
          error,
          fallbackTemp: outdoorTemp,
          outdoorSensor: this.hvacOptions.outdoorSensor
        });
      }
      
      const oldState = this.stateMachine.getCurrentState();

      // Update state machine with new conditions
      this.logger.info('⚙️ Updating state machine with new temperatures', {
        indoorTemp: newTemp,
        outdoorTemp,
        currentState: oldState,
        temperatureDelta: stateChange?.oldState?.state 
          ? newTemp - parseFloat(stateChange.oldState.state)
          : 'initial'
      });
      
      this.stateMachine.updateTemperatures(newTemp, outdoorTemp);
      
      const newState = this.stateMachine.getCurrentState();
      
      this.logger.debug('✅ State machine updated', {
        oldState,
        newState,
        stateChanged: oldState !== newState,
        temperatures: { indoor: newTemp, outdoor: outdoorTemp }
      });

      // Trigger evaluation
      this.logger.debug('🎯 Triggering evaluation and execution');
      await this.evaluateAndExecute();
      
      const processingTime = Date.now() - startTime;
      
      this.logger.info('✅ Direct state change processing completed', {
        entityId: stateChange?.entityId,
        indoorTemp: newTemp,
        outdoorTemp,
        oldState,
        newState,
        stateChanged: oldState !== newState,
        processingTimeMs: processingTime
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('❌ Direct state change processing failed', error, {
        entityId: stateChange?.entityId,
        rawState: stateChange?.newState?.state,
        processingTimeMs: processingTime,
        currentState: this.stateMachine?.getCurrentState()
      });
    }
  }

  /**
   * Monitoring loop for periodic evaluation
   */
  private async monitoringLoop(): Promise<void> {
    const interval = 300000; // 5 minutes
    let loopIteration = 0;
    
    this.logger.info('🔄 Starting HVAC monitoring loop', {
      intervalMinutes: interval / 60000,
      intervalMs: interval,
      startTime: new Date().toISOString()
    });

    try {
      while (!this.abortController?.signal.aborted) {
        const loopStart = Date.now();
        loopIteration++;
        
        try {
          this.logger.debug('🔍 Monitoring loop iteration', {
            iteration: loopIteration,
            startTime: new Date().toISOString(),
            currentState: this.stateMachine?.getCurrentState(),
            haConnected: this.haClient?.connected
          });
          
          await this.performEvaluation();
          
          const loopTime = Date.now() - loopStart;
          
          this.logger.debug('✅ Monitoring loop iteration completed', {
            iteration: loopIteration,
            evaluationTimeMs: loopTime,
            nextEvaluationIn: interval / 1000 + 's'
          });
          
          await delay(interval);
          
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            this.logger.debug('🛑 Monitoring loop aborted', {
              iteration: loopIteration,
              reason: 'abort_signal'
            });
            break;
          }
          
          const loopTime = Date.now() - loopStart;
          
          this.logger.error('❌ Error in monitoring loop', error, {
            iteration: loopIteration,
            evaluationTimeMs: loopTime,
            errorType: error instanceof Error ? error.name : 'Unknown',
            retryIn: '1 minute'
          });
          
          await delay(60000); // Wait 1 minute before retry
        }
      }
    } catch (error) {
      this.logger.error('❌ Monitoring loop failed catastrophically', error, {
        totalIterations: loopIteration,
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
    } finally {
      this.logger.info('🛑 Monitoring loop stopped', {
        totalIterations: loopIteration,
        finalState: this.stateMachine?.getCurrentState(),
        stopTime: new Date().toISOString()
      });
    }
  }

  /**
   * Perform periodic HVAC evaluation
   */
  private async performEvaluation(): Promise<void> {
    const evaluationStart = Date.now();
    
    this.logger.info('🎯 Performing periodic HVAC evaluation', {
      aiEnabled: this.appOptions.useAi && !!this.hvacAgent,
      currentState: this.stateMachine?.getCurrentState(),
      haConnected: this.haClient?.connected,
      evaluationType: this.appOptions.useAi && this.hvacAgent ? 'AI-powered' : 'direct',
      startTime: new Date().toISOString()
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
            summaryPreview: status.aiSummary?.substring(0, 150) + (status.aiSummary && status.aiSummary.length > 150 ? '...' : ''),
            evaluationTimeMs: Date.now() - evaluationStart
          });
        } else {
          this.logger.warning('⚠️ AI evaluation failed', {
            error: status.error,
            fallbackToDirect: true,
            evaluationTimeMs: Date.now() - evaluationStart
          });
          
          // Fallback to direct evaluation
          this.logger.debug('🔄 Falling back to direct state machine evaluation');
          await this.evaluateStateMachineDirect();
        }
      } else {
        // Direct state machine evaluation
        this.logger.debug('⚙️ Starting direct state machine evaluation');
        await this.evaluateStateMachineDirect();
      }
      
      const totalEvaluationTime = Date.now() - evaluationStart;
      
      this.logger.info('✅ Periodic evaluation completed', {
        evaluationType: this.appOptions.useAi && this.hvacAgent ? 'AI' : 'direct',
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.stateMachine?.getCurrentState(),
        success: true
      });
      
    } catch (error) {
      const totalEvaluationTime = Date.now() - evaluationStart;
      
      this.logger.error('❌ Periodic evaluation error', error, {
        evaluationType: this.appOptions.useAi && this.hvacAgent ? 'AI' : 'direct',
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.stateMachine?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
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
    const evaluationStart = Date.now();
    
    try {
      this.logger.debug('⚙️ Starting direct state machine evaluation', {
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
        haConnected: this.haClient.connected,
        currentState: this.stateMachine?.getCurrentState()
      });
      
      // Get current temperatures
      this.logger.debug('🌡️ Fetching indoor temperature', {
        sensor: this.hvacOptions.tempSensor
      });
      
      const indoorState = await this.haClient.getState(this.hvacOptions.tempSensor);
      const indoorTemp = indoorState.getNumericState();
      
      this.logger.debug('✅ Indoor temperature retrieved', {
        sensor: this.hvacOptions.tempSensor,
        temperature: indoorTemp,
        unit: indoorState.attributes?.unit_of_measurement,
        lastUpdated: indoorState.lastUpdated
      });

      if (indoorTemp === null) {
        this.logger.warning('⚠️ No indoor temperature available for evaluation', {
          sensor: this.hvacOptions.tempSensor,
          state: indoorState.state,
          attributes: indoorState.attributes
        });
        return;
      }

      let outdoorTemp = 20.0;
      try {
        this.logger.debug('🌡️ Fetching outdoor temperature', {
          sensor: this.hvacOptions.outdoorSensor
        });
        
        const outdoorState = await this.haClient.getState(this.hvacOptions.outdoorSensor);
        const outdoorValue = outdoorState.getNumericState();
        
        if (outdoorValue !== null) {
          outdoorTemp = outdoorValue;
          this.logger.debug('✅ Outdoor temperature retrieved', {
            sensor: this.hvacOptions.outdoorSensor,
            temperature: outdoorTemp,
            unit: outdoorState.attributes?.unit_of_measurement,
            lastUpdated: outdoorState.lastUpdated
          });
        } else {
          this.logger.warning('⚠️ Outdoor temperature is null, using fallback', {
            sensor: this.hvacOptions.outdoorSensor,
            fallbackTemp: outdoorTemp,
            state: outdoorState.state
          });
        }
      } catch (error) {
        this.logger.warning('⚠️ Failed to get outdoor temperature, using fallback', {
          error,
          sensor: this.hvacOptions.outdoorSensor,
          fallbackTemp: outdoorTemp
        });
      }
      
      const temperatureFetchTime = Date.now() - evaluationStart;
      
      this.logger.info('🌡️ Temperature data collected', {
        indoorTemp,
        outdoorTemp,
        temperatureDifference: indoorTemp - outdoorTemp,
        dataFetchTimeMs: temperatureFetchTime,
        thresholds: {
          heating: this.hvacOptions.heating.temperatureThresholds,
          cooling: this.hvacOptions.cooling.temperatureThresholds
        }
      });

      // Update state machine conditions
      this.logger.debug('⚙️ Updating state machine with temperature data');
      this.stateMachine.updateTemperatures(indoorTemp, outdoorTemp);
      
      const stateAfterUpdate = this.stateMachine.getCurrentState();
      this.logger.debug('✅ State machine temperatures updated', {
        newState: stateAfterUpdate,
        temperatures: { indoor: indoorTemp, outdoor: outdoorTemp }
      });

      // Evaluate and execute actions
      this.logger.debug('🎯 Triggering evaluation and execution');
      await this.evaluateAndExecute();
      
      const totalEvaluationTime = Date.now() - evaluationStart;
      
      this.logger.info('✅ Direct state machine evaluation completed', {
        indoorTemp,
        outdoorTemp,
        finalState: this.stateMachine.getCurrentState(),
        evaluationTimeMs: totalEvaluationTime,
        success: true
      });

    } catch (error) {
      const totalEvaluationTime = Date.now() - evaluationStart;
      
      this.logger.error('❌ Direct state machine evaluation failed', error, {
        evaluationTimeMs: totalEvaluationTime,
        currentState: this.stateMachine?.getCurrentState(),
        errorType: error instanceof Error ? error.name : 'Unknown',
        tempSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor
      });
    }
  }

  /**
   * Evaluate state machine and execute HVAC actions
   */
  private async evaluateAndExecute(): Promise<void> {
    const evaluationStart = Date.now();
    const previousState = this.stateMachine.getCurrentState();
    const previousMode = this.getCurrentHVACMode();
    const stateMachineStatus = this.stateMachine.getStatus();
    
    this.logger.info('🎯 Starting HVAC evaluation', {
      previousState,
      previousMode,
      currentConditions: stateMachineStatus.context,
      evaluationTime: new Date().toISOString()
    });
    
    // Trigger evaluation
    this.logger.debug('⚙️ Triggering state machine condition evaluation');
    this.stateMachine.evaluateConditions();
    
    const currentState = this.stateMachine.getCurrentState();
    const hvacMode = this.getCurrentHVACMode();
    const newStateMachineStatus = this.stateMachine.getStatus();
    const evaluationTime = Date.now() - evaluationStart;

    this.logger.info('✅ HVAC evaluation completed', {
      previousState,
      currentState,
      previousMode,
      hvacMode: hvacMode || 'unknown',
      stateChanged: previousState !== currentState,
      modeChanged: previousMode !== hvacMode,
      evaluationTimeMs: evaluationTime,
      conditions: newStateMachineStatus.context,
      shouldExecute: hvacMode && (previousState !== currentState || currentState === 'manualOverride')
    });

    // Execute HVAC actions if mode changed or manual override
    if (hvacMode && (previousState !== currentState || currentState === 'manualOverride')) {
      this.logger.info('⚡ Executing HVAC mode change', {
        reason: currentState === 'manualOverride' ? 'manual_override' : 'state_change',
        fromState: previousState,
        toState: currentState,
        fromMode: previousMode,
        toMode: hvacMode
      });
      
      await this.executeHVACMode(hvacMode);
    } else {
      this.logger.debug('🔄 No action required', {
        reason: !hvacMode ? 'no_hvac_mode' : 'no_state_change',
        currentState,
        hvacMode,
        stateChanged: previousState !== currentState
      });
    }
  }

  /**
   * Execute HVAC mode changes on actual devices
   */
  private async executeHVACMode(hvacMode: HVACMode, targetTemp?: number): Promise<void> {
    const executionStart = Date.now();
    
    this.logger.info('⚡ Executing HVAC mode change', {
      hvacMode,
      targetTemp,
      dryRun: this.appOptions.dryRun,
      systemMode: this.hvacOptions.systemMode,
      executionTime: new Date().toISOString()
    });

    // Get enabled entities
    const enabledEntities = this.hvacOptions.hvacEntities.filter(entity => entity.enabled);
    const disabledEntities = this.hvacOptions.hvacEntities.filter(entity => !entity.enabled);

    this.logger.debug('🏠 HVAC entities configuration', {
      totalEntities: this.hvacOptions.hvacEntities.length,
      enabledCount: enabledEntities.length,
      disabledCount: disabledEntities.length,
      enabledEntities: enabledEntities.map(e => e.entityId),
      disabledEntities: disabledEntities.map(e => e.entityId)
    });

    if (enabledEntities.length === 0) {
      this.logger.warning('⚠️ No enabled HVAC entities found - no action will be taken', {
        totalConfiguredEntities: this.hvacOptions.hvacEntities.length,
        allEntities: this.hvacOptions.hvacEntities.map(e => ({ id: e.entityId, enabled: e.enabled }))
      });
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const results: Array<{ entityId: string; success: boolean; error?: string }> = [];

    // Execute mode change for each entity
    for (const entity of enabledEntities) {
      try {
        this.logger.debug('🎯 Controlling HVAC entity', {
          entityId: entity.entityId,
          mode: hvacMode,
          targetTemp,
          entityConfig: entity
        });
        
        await this.controlHVACEntity(entity.entityId, hvacMode, targetTemp);
        
        successCount++;
        results.push({ entityId: entity.entityId, success: true });
        
        this.logger.info('✅ HVAC entity controlled successfully', {
          entityId: entity.entityId,
          mode: hvacMode,
          temperature: targetTemp,
          dryRun: this.appOptions.dryRun
        });

      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({ entityId: entity.entityId, success: false, error: errorMessage });
        
        this.logger.error('❌ Failed to control HVAC entity', error, {
          entityId: entity.entityId,
          mode: hvacMode,
          targetTemp,
          errorType: error instanceof Error ? error.name : 'Unknown'
        });
      }
    }
    
    const executionTime = Date.now() - executionStart;
    
    this.logger.info('🏁 HVAC mode execution completed', {
      hvacMode,
      targetTemp,
      totalEntities: enabledEntities.length,
      successCount,
      errorCount,
      executionTimeMs: executionTime,
      dryRun: this.appOptions.dryRun,
      results,
      overallSuccess: errorCount === 0
    });
  }

  /**
   * Control individual HVAC entity
   */
  private async controlHVACEntity(entityId: string, mode: HVACMode, targetTemp?: number): Promise<void> {
    const controlStart = Date.now();
    
    // Determine temperature and preset based on mode
    const temperature = targetTemp || (mode === HVACMode.HEAT 
      ? this.hvacOptions.heating.temperature 
      : this.hvacOptions.cooling.temperature);
    const presetMode = mode === HVACMode.HEAT 
      ? this.hvacOptions.heating.presetMode 
      : this.hvacOptions.cooling.presetMode;
    
    this.logger.info('🎯 Controlling HVAC entity', {
      entityId,
      mode,
      targetTemp,
      finalTemperature: temperature,
      presetMode,
      dryRun: this.appOptions.dryRun,
      controlTime: new Date().toISOString()
    });
    
    if (this.appOptions.dryRun) {
      this.logger.info('📝 DRY RUN: Would set HVAC mode', {
        entityId,
        hvac_mode: mode,
        service: 'climate.set_hvac_mode'
      });
      
      if (mode !== HVACMode.OFF) {
        this.logger.info('📝 DRY RUN: Would set temperature', {
          entityId,
          temperature,
          service: 'climate.set_temperature'
        });
        
        this.logger.info('📝 DRY RUN: Would set preset mode', {
          entityId,
          preset_mode: presetMode,
          service: 'climate.set_preset_mode'
        });
      }
      
      const dryRunTime = Date.now() - controlStart;
      this.logger.debug('✅ DRY RUN: Entity control simulation completed', {
        entityId,
        mode,
        temperature,
        presetMode,
        simulationTimeMs: dryRunTime
      });
      
      return;
    }

    try {
      // Set HVAC mode
      this.logger.debug('🔧 Setting HVAC mode', {
        entityId,
        mode,
        service: 'climate.set_hvac_mode'
      });
      
      const modeCall = HassServiceCallImpl.climate('set_hvac_mode', entityId, { hvac_mode: mode });
      await this.haClient.callService(modeCall);
      
      this.logger.debug('✅ HVAC mode set successfully', { entityId, mode });

      // Set temperature and preset if not turning off
      if (mode !== HVACMode.OFF) {
        this.logger.debug('🌡️ Setting temperature', {
          entityId,
          temperature,
          service: 'climate.set_temperature'
        });
        
        const tempCall = HassServiceCallImpl.climate('set_temperature', entityId, { temperature });
        await this.haClient.callService(tempCall);
        
        this.logger.debug('✅ Temperature set successfully', { entityId, temperature });

        this.logger.debug('⚙️ Setting preset mode', {
          entityId,
          presetMode,
          service: 'climate.set_preset_mode'
        });
        
        const presetCall = HassServiceCallImpl.climate('set_preset_mode', entityId, { preset_mode: presetMode });
        await this.haClient.callService(presetCall);
        
        this.logger.debug('✅ Preset mode set successfully', { entityId, presetMode });
      } else {
        this.logger.debug('⏹️ HVAC turned off - skipping temperature and preset configuration', {
          entityId,
          mode
        });
      }
      
      const controlTime = Date.now() - controlStart;
      
      this.logger.info('✅ HVAC entity control completed successfully', {
        entityId,
        mode,
        temperature: mode !== HVACMode.OFF ? temperature : undefined,
        presetMode: mode !== HVACMode.OFF ? presetMode : undefined,
        controlTimeMs: controlTime,
        servicesCalledCount: mode !== HVACMode.OFF ? 3 : 1
      });
      
    } catch (error) {
      const controlTime = Date.now() - controlStart;
      
      this.logger.error('❌ Failed to control HVAC entity', error, {
        entityId,
        mode,
        temperature,
        presetMode,
        controlTimeMs: controlTime,
        errorType: error instanceof Error ? error.name : 'Unknown'
      });
      
      throw error;
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