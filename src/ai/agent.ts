/**
 * AI Agent for HAG JavaScript variant.
 *
 * LangChain-powered agent for intelligent HVAC decision making using traditional patterns.
 */

import { injectable } from '@needle-di/core';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { LoggerService } from '../core/logger.ts';
import type { ApplicationOptions, HvacOptions } from '../config/config.ts';
import { HVACStateMachine } from '../hvac/state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { HVACMode, OperationResult } from '../types/common.ts';
import { AIError } from '../core/exceptions.ts';

/**
 * HVAC status summary interface
 */
interface HVACStatusSummary {
  success: boolean;
  aiSummary?: string;
  recommendations?: string[];
  error?: string;
}

/**
 * Temperature change event data
 */
interface TemperatureChangeEvent {
  entityId: string;
  newState: string;
  oldState?: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

/**
 * HVAC control tool for LangChain
 */
class HVACControlTool extends Tool {
  name = 'hvac_control';
  description =
    'Control HVAC system (heat, cool, off) with optional target temperature';

  constructor(
    private stateMachine: HVACStateMachine,
    private logger: LoggerService,
  ) {
    super();
  }

  _call(input: string): Promise<string> {
    const executionStart = Date.now();

    try {
      this.logger.info('🤖 AI executing HVAC control tool', {
        input,
        timestamp: new Date().toISOString(),
      });

      const { action, temperature } = JSON.parse(input);

      this.logger.debug('📝 AI parsed HVAC control parameters', {
        action,
        temperature,
        hasTemperature: temperature !== undefined,
      });

      // Parse HVAC mode
      let mode: HVACMode;
      switch (action.toLowerCase()) {
        case 'heat':
          mode = HVACMode.HEAT;
          break;
        case 'cool':
          mode = HVACMode.COOL;
          break;
        case 'off':
          mode = HVACMode.OFF;
          break;
        default:
          this.logger.warning('⚠️ AI provided invalid HVAC action', {
            action,
            validActions: ['heat', 'cool', 'off'],
          });
          return Promise.resolve(
            `Error: Invalid action '${action}'. Use 'heat', 'cool', or 'off'.`,
          );
      }

      const currentState = this.stateMachine.getCurrentState();
      const currentContext = this.stateMachine.getContext();

      this.logger.info('⚡ AI executing HVAC mode change', {
        requestedMode: mode,
        requestedTemperature: temperature,
        currentState,
        currentContext,
        decisionRationale: 'AI_agent_decision',
      });

      // Execute manual override
      this.stateMachine.manualOverride(mode, temperature);

      const newState = this.stateMachine.getCurrentState();
      const executionTime = Date.now() - executionStart;

      this.logger.info('✅ AI HVAC control executed successfully', {
        action,
        mode,
        temperature,
        oldState: currentState,
        newState,
        stateChanged: currentState !== newState,
        executionTimeMs: executionTime,
      });

      return Promise.resolve(
        `Successfully set HVAC to ${action}${
          temperature ? ` at ${temperature}°C` : ''
        }. State changed from ${currentState} to ${newState}.`,
      );
    } catch (error) {
      const executionTime = Date.now() - executionStart;
      const errorMsg = `Failed to control HVAC: ${
        error instanceof Error ? error.message : String(error)
      }`;

      this.logger.error('❌ AI HVAC control failed', error, {
        input,
        executionTimeMs: executionTime,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });

      return Promise.resolve(errorMsg);
    }
  }
}

/**
 * Temperature reading tool for LangChain
 */
class TemperatureReadingTool extends Tool {
  name = 'get_temperature';
  description = 'Get current indoor and outdoor temperature readings';

  constructor(
    private haClient: HomeAssistantClient,
    private hvacOptions: HvacOptions,
    private logger: LoggerService,
  ) {
    super();
  }

  async _call(_input: string): Promise<string> {
    const readingStart = Date.now();

    try {
      this.logger.info('🌡️ AI reading temperature data', {
        indoorSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
        timestamp: new Date().toISOString(),
      });

      // Get indoor temperature
      this.logger.debug('🏠 AI fetching indoor temperature');
      const indoorState = await this.haClient.getState(
        this.hvacOptions.tempSensor,
      );
      const indoorTemp = indoorState.getNumericState();

      this.logger.debug('✅ AI indoor temperature retrieved', {
        sensor: this.hvacOptions.tempSensor,
        temperature: indoorTemp,
        state: indoorState.state,
        lastUpdated: indoorState.lastUpdated,
      });

      // Get outdoor temperature
      let outdoorTemp: number | null = null;
      try {
        this.logger.debug('🌡️ AI fetching outdoor temperature');
        const outdoorState = await this.haClient.getState(
          this.hvacOptions.outdoorSensor,
        );
        outdoorTemp = outdoorState.getNumericState();

        this.logger.debug('✅ AI outdoor temperature retrieved', {
          sensor: this.hvacOptions.outdoorSensor,
          temperature: outdoorTemp,
          state: outdoorState.state,
          lastUpdated: outdoorState.lastUpdated,
        });
      } catch (error) {
        this.logger.warning('⚠️ AI failed to get outdoor temperature', {
          error,
          sensor: this.hvacOptions.outdoorSensor,
          fallbackBehavior: 'continue_with_null',
        });
      }

      const result = {
        indoor: indoorTemp,
        outdoor: outdoorTemp,
        timestamp: new Date().toISOString(),
      };

      const readingTime = Date.now() - readingStart;

      this.logger.info('✅ AI temperature reading completed', {
        ...result,
        readingTimeMs: readingTime,
        indoorValid: indoorTemp !== null,
        outdoorValid: outdoorTemp !== null,
        temperatureDifference: indoorTemp && outdoorTemp
          ? indoorTemp - outdoorTemp
          : null,
      });

      return JSON.stringify(result);
    } catch (error) {
      const readingTime = Date.now() - readingStart;
      const errorMsg = `Failed to read temperatures: ${
        error instanceof Error ? error.message : String(error)
      }`;

      this.logger.error('❌ AI temperature reading failed', error, {
        readingTimeMs: readingTime,
        indoorSensor: this.hvacOptions.tempSensor,
        outdoorSensor: this.hvacOptions.outdoorSensor,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });

      return errorMsg;
    }
  }
}

/**
 * HVAC status tool for LangChain
 */
class HVACStatusTool extends Tool {
  name = 'get_hvac_status';
  description = 'Get current HVAC system status and state machine information';

  constructor(
    private stateMachine: HVACStateMachine,
    private logger: LoggerService,
  ) {
    super();
  }

  _call(_input: string): Promise<string> {
    const statusStart = Date.now();

    try {
      this.logger.info('📋 AI reading HVAC status', {
        timestamp: new Date().toISOString(),
      });

      const status = this.stateMachine.getStatus();

      const result = {
        currentState: status.currentState,
        context: status.context,
        canHeat: status.canHeat,
        canCool: status.canCool,
        systemMode: status.systemMode,
        timestamp: new Date().toISOString(),
      };

      const statusTime = Date.now() - statusStart;

      this.logger.info('✅ AI HVAC status retrieved', {
        ...result,
        statusTimeMs: statusTime,
        hasTemperatureData:
          !!(status.context.indoorTemp && status.context.outdoorTemp),
        isActive: status.currentState !== 'idle',
      });

      return Promise.resolve(JSON.stringify(result));
    } catch (error) {
      const statusTime = Date.now() - statusStart;
      const errorMsg = `Failed to get HVAC status: ${
        error instanceof Error ? error.message : String(error)
      }`;

      this.logger.error('❌ AI status reading failed', error, {
        statusTimeMs: statusTime,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });

      return Promise.resolve(errorMsg);
    }
  }
}

@injectable()
export class HVACAgent {
  private llm: ChatOpenAI;
  private tools: Tool[];
  private agent?: AgentExecutor;
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage)[] =
    [];

  private hvacOptions: HvacOptions;
  private appOptions: ApplicationOptions;
  private stateMachine: HVACStateMachine;
  private haClient: HomeAssistantClient;
  private logger: LoggerService;

  constructor(
    hvacOptions?: HvacOptions,
    appOptions?: ApplicationOptions,
    stateMachine?: HVACStateMachine,
    haClient?: HomeAssistantClient,
    logger?: LoggerService,
  ) {
    this.hvacOptions = hvacOptions!;
    this.appOptions = appOptions!;
    this.stateMachine = stateMachine!;
    this.haClient = haClient!;
    this.logger = logger!;
    // Initialize OpenAI LLM
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.1,
      openAIApiKey: this.appOptions.openaiApiKey,
    });

    // Initialize tools
    this.tools = [
      new HVACControlTool(this.stateMachine, this.logger),
      new TemperatureReadingTool(this.haClient, this.hvacOptions, this.logger),
      new HVACStatusTool(this.stateMachine, this.logger),
    ];

    // Don't initialize agent in constructor - will be done lazily or explicitly
  }

  /**
   * Initialize the agent (must be called before using the agent)
   */
  async initialize(): Promise<void> {
    if (!this.agent) {
      await this.initializeAgent();
    }
  }

  /**
   * Initialize the LangChain agent
   */
  private async initializeAgent(): Promise<void> {
    const initStart = Date.now();

    try {
      this.logger.info('🤖 Initializing AI agent', {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        systemMode: this.hvacOptions.systemMode,
        toolsCount: this.tools.length,
        hasApiKey: !!this.appOptions.openaiApiKey,
        logLevel: this.appOptions.logLevel,
        timestamp: new Date().toISOString(),
      });

      const systemPrompt =
        `You are an intelligent HVAC automation agent for a home automation system.

Your role is to:
1. Monitor temperature changes and make intelligent heating/cooling decisions
2. Analyze HVAC system efficiency and provide recommendations
3. Handle manual override requests with validation
4. Provide status summaries and insights

Current HVAC Configuration:
- System Mode: ${this.hvacOptions.systemMode}
- Temperature Sensor: ${this.hvacOptions.tempSensor}
- Outdoor Sensor: ${this.hvacOptions.outdoorSensor}
- Heating Target: ${this.hvacOptions.heating.temperature}°C
- Cooling Target: ${this.hvacOptions.cooling.temperature}°C
- Heating Range: ${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C
- Cooling Range: ${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.indoorMax}°C

Available Tools:
1. hvac_control - Control HVAC system (heat/cool/off)
2. get_temperature - Read current temperatures
3. get_hvac_status - Get system status

Always consider:
- Energy efficiency
- Comfort optimization
- Outdoor weather conditions
- Time of day and usage patterns
- System constraints and thresholds

Respond concisely and provide actionable insights.`;

      this.logger.debug('📝 AI system prompt configured', {
        promptLength: systemPrompt.length,
        configurationIncluded: {
          systemMode: true,
          sensors: true,
          thresholds: true,
          targets: true,
        },
      });

      const prompt = ChatPromptTemplate.fromMessages([
        ['system', systemPrompt],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      this.logger.debug('⚙️ Creating LangChain agent', {
        toolsAvailable: this.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
        llmModel: 'gpt-4o-mini',
      });

      const agent = await createToolCallingAgent({
        llm: this.llm as never,
        tools: this.tools,
        prompt,
      });

      this.agent = new AgentExecutor({
        agent,
        tools: this.tools,
        verbose: this.appOptions.logLevel === 'debug',
        maxIterations: 10,
        handleParsingErrors: true,
      });

      const initTime = Date.now() - initStart;

      this.logger.info('✅ AI agent initialized successfully', {
        initializationTimeMs: initTime,
        maxIterations: 10,
        verboseMode: this.appOptions.logLevel === 'debug',
        toolsRegistered: this.tools.length,
        agentReady: !!this.agent,
      });
    } catch (error) {
      const initTime = Date.now() - initStart;

      this.logger.error('❌ Failed to initialize AI agent', error, {
        initializationTimeMs: initTime,
        errorType: error instanceof Error ? error.name : 'Unknown',
        hasApiKey: !!this.appOptions.openaiApiKey,
        toolsCount: this.tools.length,
      });

      throw new AIError(
        `Failed to initialize AI agent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Process temperature change events
   */
  async processTemperatureChange(
    event: TemperatureChangeEvent,
  ): Promise<OperationResult> {
    const processingStart = Date.now();

    if (!this.agent) {
      await this.initializeAgent();
    }

    try {
      this.logger.info('🌡️ AI processing temperature change event', {
        entityId: event.entityId,
        newState: event.newState,
        oldState: event.oldState,
        timestamp: event.timestamp,
        hasAttributes: !!event.attributes,
        temperatureChange: event.oldState && event.newState
          ? parseFloat(event.newState) - parseFloat(event.oldState || '0')
          : 'initial',
        conversationHistoryLength: this.conversationHistory.length,
      });

      const input = `Temperature sensor ${event.entityId} changed from ${
        event.oldState || 'unknown'
      } to ${event.newState} at ${event.timestamp}. 

Please analyze this change and determine if any HVAC action is needed. Consider:
1. Current system status and mode
2. Temperature thresholds and targets
3. Outdoor conditions
4. Energy efficiency

If action is needed, execute the appropriate HVAC control.`;

      this.logger.debug('🤖 AI invoking agent for temperature analysis', {
        inputLength: input.length,
        historyLength: this.conversationHistory.length,
        entityId: event.entityId,
      });

      const result = await this.agent!.invoke({
        input,
        chat_history: this.conversationHistory,
      });

      // Add to conversation history
      this.conversationHistory.push(new HumanMessage(input));
      this.conversationHistory.push(new AIMessage(result.output));

      // Keep conversation history manageable
      if (this.conversationHistory.length > 20) {
        const removedCount = this.conversationHistory.length - 20;
        this.conversationHistory = this.conversationHistory.slice(-20);

        this.logger.debug('📋 AI conversation history trimmed', {
          removedMessages: removedCount,
          currentLength: this.conversationHistory.length,
        });
      }

      const processingTime = Date.now() - processingStart;

      this.logger.info('✅ AI temperature change processing completed', {
        entityId: event.entityId,
        output: result.output.substring(0, 150) +
          (result.output.length > 150 ? '...' : ''),
        outputLength: result.output.length,
        intermediateSteps: result.intermediateSteps?.length || 0,
        processingTimeMs: processingTime,
        // deno-lint-ignore no-explicit-any
        toolsUsed: result.intermediateSteps?.map((step: any) =>
          step?.action?.tool
        ) || [],
        conversationLength: this.conversationHistory.length,
      });

      return {
        success: true,
        data: {
          aiResponse: result.output,
          steps: result.intermediateSteps?.length || 0,
          // deno-lint-ignore no-explicit-any
          toolsUsed: result.intermediateSteps?.map((step: any) =>
            step?.action?.tool
          ) || [],
          processingTimeMs: processingTime,
          entityId: event.entityId,
          temperatureChange: event.oldState && event.newState
            ? parseFloat(event.newState) - parseFloat(event.oldState || '0')
            : null,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const processingTime = Date.now() - processingStart;

      this.logger.error('❌ AI temperature change processing failed', error, {
        entityId: event.entityId,
        newState: event.newState,
        oldState: event.oldState,
        processingTimeMs: processingTime,
        errorType: error instanceof Error ? error.name : 'Unknown',
        conversationLength: this.conversationHistory.length,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Handle manual override requests
   */
  async manualOverride(
    action: string,
    options: Record<string, unknown>,
  ): Promise<OperationResult> {
    const overrideStart = Date.now();

    if (!this.agent) {
      await this.initializeAgent();
    }

    try {
      this.logger.info('🎯 AI processing manual override request', {
        action,
        options,
        hasTemperature: options.temperature !== undefined,
        requestedTemperature: options.temperature,
        conversationHistoryLength: this.conversationHistory.length,
        timestamp: new Date().toISOString(),
      });

      const input = `User requested manual HVAC override: action="${action}"${
        options.temperature ? `, temperature=${options.temperature}°C` : ''
      }.

Please:
1. Validate this request against current conditions and thresholds
2. Check if this action makes sense given current indoor/outdoor temperatures
3. Execute the HVAC control if appropriate
4. Provide feedback on the action and any recommendations

Use the hvac_control tool to execute the override: {"action": "${action}"${
        options.temperature ? `, "temperature": ${options.temperature}` : ''
      }}.`;

      this.logger.debug('🤖 AI invoking agent for manual override validation', {
        inputLength: input.length,
        action,
        hasTemperatureOverride: !!options.temperature,
      });

      const result = await this.agent!.invoke({
        input,
        chat_history: this.conversationHistory,
      });

      // Add to conversation history
      this.conversationHistory.push(new HumanMessage(input));
      this.conversationHistory.push(new AIMessage(result.output));

      const overrideTime = Date.now() - overrideStart;

      this.logger.info('✅ AI manual override completed', {
        action,
        options,
        output: result.output.substring(0, 150) +
          (result.output.length > 150 ? '...' : ''),
        outputLength: result.output.length,
        intermediateSteps: result.intermediateSteps?.length || 0,
        overrideTimeMs: overrideTime,
        // deno-lint-ignore no-explicit-any
        toolsUsed: result.intermediateSteps?.map((step: any) =>
          step?.action?.tool
        ) || [],
        validationPassed: !result.output.toLowerCase().includes('error'),
        conversationLength: this.conversationHistory.length,
      });

      return {
        success: true,
        data: {
          aiResponse: result.output,
          action,
          options,
          steps: result.intermediateSteps?.length || 0,
          // deno-lint-ignore no-explicit-any
          toolsUsed: result.intermediateSteps?.map((step: any) =>
            step?.action?.tool
          ) || [],
          overrideTimeMs: overrideTime,
          validationResult: !result.output.toLowerCase().includes('error')
            ? 'approved'
            : 'rejected',
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const overrideTime = Date.now() - overrideStart;

      this.logger.error('❌ AI manual override failed', error, {
        action,
        options,
        overrideTimeMs: overrideTime,
        errorType: error instanceof Error ? error.name : 'Unknown',
        conversationLength: this.conversationHistory.length,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Evaluate system efficiency
   */
  async evaluateEfficiency(): Promise<OperationResult> {
    if (!this.agent) {
      await this.initializeAgent();
    }

    try {
      this.logger.info('AI evaluating system efficiency');

      const input =
        `Please analyze the current HVAC system efficiency and performance.

Steps:
1. Get current temperatures using get_temperature tool
2. Get HVAC status using get_hvac_status tool
3. Analyze efficiency based on:
   - Temperature differential between indoor/outdoor
   - Current system state and mode
   - How well the system is maintaining target temperatures
   - Energy efficiency considerations
4. Provide specific recommendations for improvement

Please provide a comprehensive analysis with actionable recommendations.`;

      const result = await this.agent!.invoke({
        input,
        chat_history: this.conversationHistory,
      });

      // Add to conversation history
      this.conversationHistory.push(new HumanMessage(input));
      this.conversationHistory.push(new AIMessage(result.output));

      this.logger.info('AI efficiency evaluation completed');

      return {
        success: true,
        data: {
          analysis: result.output,
          recommendations: this.extractRecommendations(result.output),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('AI efficiency evaluation failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get system status summary
   */
  async getStatusSummary(): Promise<HVACStatusSummary> {
    if (!this.agent) {
      await this.initializeAgent();
    }

    try {
      this.logger.debug('AI generating status summary');

      const input = `Please provide a brief status summary of the HVAC system.

Steps:
1. Get current temperatures
2. Get HVAC status
3. Provide a concise summary (2-3 sentences) covering:
   - Current system state
   - Temperature conditions
   - Any immediate recommendations

Keep the summary brief and informative.`;

      const result = await this.agent!.invoke({
        input,
        chat_history: this.conversationHistory.slice(-6), // Limited history for status
      });

      return {
        success: true,
        aiSummary: result.output,
        recommendations: this.extractRecommendations(result.output),
      };
    } catch (error) {
      this.logger.error('AI status summary failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract recommendations from AI output
   */
  private extractRecommendations(text: string): string[] {
    const recommendations: string[] = [];

    // Look for bullet points or numbered lists
    const bulletRegex = /(?:^|\n)[•\-\*]\s*(.+)/g;
    const numberedRegex = /(?:^|\n)\d+\.\s*(.+)/g;

    let match;
    while ((match = bulletRegex.exec(text)) !== null) {
      recommendations.push(match[1].trim());
    }

    while ((match = numberedRegex.exec(text)) !== null) {
      recommendations.push(match[1].trim());
    }

    // If no structured recommendations found, look for sentences with recommendation keywords
    if (recommendations.length === 0) {
      const sentences = text.split(/[.!?]\s+/);
      for (const sentence of sentences) {
        if (
          /\b(recommend|suggest|should|consider|optimize|improve)\b/i.test(
            sentence,
          )
        ) {
          recommendations.push(sentence.trim());
        }
      }
    }

    return recommendations.slice(0, 5); // Limit to 5 recommendations
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.logger.debug('AI conversation history cleared');
  }

  /**
   * Get conversation history length
   */
  getHistoryLength(): number {
    return this.conversationHistory.length;
  }
}
