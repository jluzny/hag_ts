/**
 * AI Agent for HAG JavaScript variant.
 * 
 * LangChain-powered agent for intelligent HVAC decision making using traditional patterns.
 */

import { injectable, inject } from '@needle-di/core';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { TYPES, LoggerService } from '../core/container.ts';
import { HvacOptions, ApplicationOptions } from '../config/settings.ts';
import { HVACStateMachine } from '../hvac/state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { HVACMode, OperationResult } from '../types/common.ts';
import { AIError, StateError } from '../core/exceptions.ts';

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
  description = 'Control HVAC system (heat, cool, off) with optional target temperature';

  constructor(
    private stateMachine: HVACStateMachine,
    private logger: LoggerService,
  ) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const { action, temperature } = JSON.parse(input);
      
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
          return `Error: Invalid action '${action}'. Use 'heat', 'cool', or 'off'.`;
      }

      // Execute manual override
      this.stateMachine.manualOverride(mode, temperature);
      
      this.logger.debug('AI agent executed HVAC control', { action, temperature });
      
      return `Successfully set HVAC to ${action}${temperature ? ` at ${temperature}°C` : ''}`;
      
    } catch (error) {
      const errorMsg = `Failed to control HVAC: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error('AI HVAC control failed', error);
      return errorMsg;
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
    try {
      // Get indoor temperature
      const indoorState = await this.haClient.getState(this.hvacOptions.tempSensor);
      const indoorTemp = indoorState.getNumericState();

      // Get outdoor temperature
      let outdoorTemp: number | null = null;
      try {
        const outdoorState = await this.haClient.getState(this.hvacOptions.outdoorSensor);
        outdoorTemp = outdoorState.getNumericState();
      } catch (error) {
        this.logger.warning('Failed to get outdoor temperature', error);
      }

      const result = {
        indoor: indoorTemp,
        outdoor: outdoorTemp,
        timestamp: new Date().toISOString(),
      };

      this.logger.debug('AI agent read temperatures', result);
      
      return JSON.stringify(result);

    } catch (error) {
      const errorMsg = `Failed to read temperatures: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error('AI temperature reading failed', error);
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

  async _call(_input: string): Promise<string> {
    try {
      const status = this.stateMachine.getStatus();
      
      const result = {
        currentState: status.currentState,
        context: status.context,
        timestamp: new Date().toISOString(),
      };

      this.logger.debug('AI agent read HVAC status', result);
      
      return JSON.stringify(result);

    } catch (error) {
      const errorMsg = `Failed to get HVAC status: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error('AI status reading failed', error);
      return errorMsg;
    }
  }
}

@injectable()
export class HVACAgent {
  private llm: ChatOpenAI;
  private tools: Tool[];
  private agent?: AgentExecutor;
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage)[] = [];

  constructor(
    @inject(TYPES.HvacOptions) private hvacOptions: HvacOptions,
    @inject(TYPES.ApplicationOptions) private appOptions: ApplicationOptions,
    @inject(TYPES.HVACStateMachine) private stateMachine: HVACStateMachine,
    @inject(TYPES.HomeAssistantClient) private haClient: HomeAssistantClient,
    @inject(TYPES.Logger) private logger: LoggerService,
  ) {
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

    this.initializeAgent();
  }

  /**
   * Initialize the LangChain agent
   */
  private async initializeAgent(): Promise<void> {
    try {
      const systemPrompt = `You are an intelligent HVAC automation agent for a home automation system.

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

      const prompt = ChatPromptTemplate.fromMessages([
        ['system', systemPrompt],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      const agent = await createToolCallingAgent({
        llm: this.llm,
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

      this.logger.info('AI agent initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize AI agent', error);
      throw new AIError(`Failed to initialize AI agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process temperature change events
   */
  async processTemperatureChange(event: TemperatureChangeEvent): Promise<OperationResult> {
    if (!this.agent) {
      throw new AIError('AI agent not initialized');
    }

    try {
      this.logger.info('AI processing temperature change', {
        entityId: event.entityId,
        newState: event.newState,
        oldState: event.oldState,
      });

      const input = `Temperature sensor ${event.entityId} changed from ${event.oldState || 'unknown'} to ${event.newState} at ${event.timestamp}. 

Please analyze this change and determine if any HVAC action is needed. Consider:
1. Current system status and mode
2. Temperature thresholds and targets
3. Outdoor conditions
4. Energy efficiency

If action is needed, execute the appropriate HVAC control.`;

      const result = await this.agent.invoke({
        input,
        chat_history: this.conversationHistory,
      });

      // Add to conversation history
      this.conversationHistory.push(new HumanMessage(input));
      this.conversationHistory.push(new AIMessage(result.output));

      // Keep conversation history manageable
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      this.logger.info('AI temperature change processing completed', {
        output: result.output.substring(0, 100),
      });

      return {
        success: true,
        data: {
          aiResponse: result.output,
          steps: result.intermediateSteps?.length || 0,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error('AI temperature change processing failed', error);
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
  async manualOverride(action: string, options: Record<string, unknown>): Promise<OperationResult> {
    if (!this.agent) {
      throw new AIError('AI agent not initialized');
    }

    try {
      this.logger.info('AI processing manual override', { action, options });

      const input = `User requested manual HVAC override: action="${action}"${options.temperature ? `, temperature=${options.temperature}°C` : ''}.

Please:
1. Validate this request against current conditions and thresholds
2. Check if this action makes sense given current indoor/outdoor temperatures
3. Execute the HVAC control if appropriate
4. Provide feedback on the action and any recommendations

Use the hvac_control tool to execute the override: {"action": "${action}"${options.temperature ? `, "temperature": ${options.temperature}` : ''}}.`;

      const result = await this.agent.invoke({
        input,
        chat_history: this.conversationHistory,
      });

      // Add to conversation history
      this.conversationHistory.push(new HumanMessage(input));
      this.conversationHistory.push(new AIMessage(result.output));

      this.logger.info('AI manual override completed', {
        action,
        output: result.output.substring(0, 100),
      });

      return {
        success: true,
        data: {
          aiResponse: result.output,
          action,
          options,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error('AI manual override failed', error);
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
      throw new AIError('AI agent not initialized');
    }

    try {
      this.logger.info('AI evaluating system efficiency');

      const input = `Please analyze the current HVAC system efficiency and performance.

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

      const result = await this.agent.invoke({
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
      return {
        success: false,
        error: 'AI agent not initialized',
      };
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

      const result = await this.agent.invoke({
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
        if (/\b(recommend|suggest|should|consider|optimize|improve)\b/i.test(sentence)) {
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