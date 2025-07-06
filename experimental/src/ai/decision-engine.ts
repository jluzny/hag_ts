/**
 * AI Decision Engine for HVAC System
 *
 * This module implements intelligent decision-making using LangChain and OpenAI
 * to replace traditional rule-based HVAC logic with AI-powered reasoning.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { DecisionResult, HVACDecisionContext } from './types/ai-types.ts';
import { SystemMode } from '../types/common.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * Configuration for AI decision engine
 */
export interface AIDecisionConfig {
  openaiApiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  fallbackToRules: boolean;
  maxRetries: number;
  timeoutMs: number;
}

/**
 * AI-powered decision engine for HVAC control
 */
export class AIDecisionEngine {
  private chatModel!: ChatOpenAI;
  private isEnabled: boolean;
  private fallbackToRules: boolean;
  private logger: LoggerService;

  constructor(
    private config: AIDecisionConfig,
    logger: LoggerService,
  ) {
    this.logger = logger;
    this.isEnabled = config.enabled && !!config.openaiApiKey;
    this.fallbackToRules = config.fallbackToRules;

    if (this.isEnabled) {
      try {
        this.chatModel = new ChatOpenAI({
          openAIApiKey: config.openaiApiKey,
          modelName: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          timeout: config.timeoutMs,
        });

        this.logger.info('🤖 [AI Engine] Initialized successfully', {
          model: config.model,
          enabled: this.isEnabled,
        });
      } catch (error) {
        this.logger.error('❌ [AI Engine] Failed to initialize', error);
        this.isEnabled = false;
      }
    } else {
      this.logger.info('🤖 [AI Engine] Disabled or no API key provided');
    }
  }

  /**
   * Make an AI-powered HVAC decision
   */
  async makeDecision(context: HVACDecisionContext): Promise<DecisionResult> {
    if (!this.isEnabled) {
      return this.fallbackDecision(context, 'AI_DISABLED');
    }

    try {
      const startTime = performance.now();

      this.logger.debug('🧠 [AI Engine] Making decision', {
        indoorTemp: context.indoorTemp,
        outdoorTemp: context.outdoorTemp,
        systemMode: context.systemMode,
        currentMode: context.currentMode,
      });

      const aiResponse = await this.callAI(context);
      const decision = this.parseAIResponse(aiResponse);

      const executionTime = performance.now() - startTime;

      this.logger.info('✅ [AI Engine] Decision made', {
        decision: decision.action,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        executionTimeMs: executionTime,
      });

      return {
        ...decision,
        source: 'ai',
        executionTimeMs: executionTime,
        fallbackUsed: false,
      };
    } catch (error) {
      this.logger.error('❌ [AI Engine] Decision failed', error);

      if (this.fallbackToRules) {
        return this.fallbackDecision(context, 'AI_ERROR');
      } else {
        throw error;
      }
    }
  }

  /**
   * Call OpenAI API with HVAC context
   */
  private async callAI(context: HVACDecisionContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(context);

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await this.chatModel.invoke(messages);
    return response.content as string;
  }

  /**
   * Build system prompt for AI
   */
  private buildSystemPrompt(): string {
    return `You are an intelligent HVAC control system making decisions about heating, cooling, and idle states.

ROLE: You are an expert HVAC controller that makes optimal decisions considering comfort, energy efficiency, and system health.

OBJECTIVES:
1. Maintain comfortable indoor temperature (18-24°C optimal range)
2. Minimize energy consumption while ensuring comfort
3. Protect HVAC equipment from unnecessary cycling
4. Consider outdoor temperature for efficiency optimization
5. Respect system mode constraints (AUTO, HEAT_ONLY, COOL_ONLY, OFF)

DECISION OPTIONS:
- "heating": Activate heating system
- "cooling": Activate cooling system  
- "idle": Keep system idle (most energy efficient)
- "off": Turn system off

RESPONSE FORMAT:
Provide your response as a JSON object with these exact keys:
{
  "action": "heating|cooling|idle|off",
  "confidence": 0.0-1.0,
  "reasoning": "Clear explanation of decision rationale",
  "factors": ["list", "of", "key", "factors", "considered"],
  "energyImpact": "low|medium|high",
  "comfortImpact": "low|medium|high"
}

IMPORTANT: Always respond with valid JSON. Consider all factors including temperature differentials, outdoor conditions, system efficiency, and user comfort.`;
  }

  /**
   * Build user prompt with current context
   */
  private buildUserPrompt(context: HVACDecisionContext): string {
    const {
      indoorTemp,
      outdoorTemp,
      targetTemp,
      systemMode,
      currentMode,
      currentHour,
      isWeekday,
      manualOverride,
      lastTransitionTime,
      energyPrice,
    } = context;

    let prompt = `Please make an HVAC decision based on the current conditions:

CURRENT CONDITIONS:
- Indoor Temperature: ${indoorTemp ?? 'unknown'}°C
- Outdoor Temperature: ${outdoorTemp ?? 'unknown'}°C
- Target Temperature: ${targetTemp ?? 22}°C
- System Mode: ${systemMode}
- Current HVAC State: ${currentMode}
- Time: ${currentHour ?? 12}:00 (${isWeekday ? 'weekday' : 'weekend'})`;

    if (manualOverride?.active) {
      prompt +=
        `\n- Manual Override: Active (${manualOverride.mode} until ${manualOverride.expiresAt})`;
    }

    if (lastTransitionTime) {
      const timeSinceTransition = (Date.now() - lastTransitionTime.getTime()) /
        1000 / 60; // minutes
      prompt += `\n- Time Since Last Change: ${
        timeSinceTransition.toFixed(1)
      } minutes`;
    }

    if (energyPrice) {
      prompt +=
        `\n- Current Energy Price: ${energyPrice.level} (${energyPrice.rate} per kWh)`;
    }

    prompt += `\n\nCONSIDERATIONS:
- Avoid frequent cycling (minimum 5-10 minutes between state changes)
- Outdoor temperature affects heating/cooling efficiency
- Consider time of day for energy optimization
- Respect system mode limitations
- Manual overrides take precedence when active

Please provide your decision as JSON.`;

    return prompt;
  }

  /**
   * Parse AI response into structured decision
   */
  private parseAIResponse(response: string): DecisionResult {
    try {
      // Extract JSON from response (handle cases where AI adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.action || !parsed.reasoning) {
        throw new Error('Missing required fields in AI response');
      }

      // Validate action
      const validActions = ['heating', 'cooling', 'idle', 'off'];
      if (!validActions.includes(parsed.action)) {
        throw new Error(`Invalid action: ${parsed.action}`);
      }

      return {
        action: parsed.action,
        confidence: parsed.confidence ?? 0.8,
        reasoning: parsed.reasoning,
        factors: parsed.factors ?? [],
        energyImpact: parsed.energyImpact ?? 'medium',
        comfortImpact: parsed.comfortImpact ?? 'medium',
        source: 'ai',
        executionTimeMs: 0, // Set by caller
        fallbackUsed: false,
      };
    } catch (error) {
      this.logger.error('❌ [AI Engine] Failed to parse AI response', error, {
        response: response.substring(0, 200),
      });
      throw new Error(
        `Failed to parse AI response: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Fallback to rule-based decision when AI is unavailable
   */
  private fallbackDecision(
    context: HVACDecisionContext,
    reason: string,
  ): DecisionResult {
    this.logger.warning('⚠️ [AI Engine] Using fallback decision', { reason });

    const { indoorTemp, targetTemp = 22, systemMode } = context;

    // Simple rule-based logic as fallback
    let action = 'idle';
    let reasoning = 'Using rule-based fallback logic. ';

    if (!indoorTemp) {
      action = 'idle';
      reasoning += 'No temperature data available, staying idle.';
    } else if (systemMode === SystemMode.OFF) {
      action = 'off';
      reasoning += 'System mode is OFF.';
    } else {
      const tempDiff = indoorTemp - targetTemp;

      if (tempDiff < -1.5 && systemMode !== SystemMode.COOL_ONLY) {
        action = 'heating';
        reasoning += `Indoor temp ${indoorTemp}°C is ${
          Math.abs(tempDiff).toFixed(1)
        }°C below target ${targetTemp}°C.`;
      } else if (tempDiff > 1.5 && systemMode !== SystemMode.HEAT_ONLY) {
        action = 'cooling';
        reasoning += `Indoor temp ${indoorTemp}°C is ${
          tempDiff.toFixed(1)
        }°C above target ${targetTemp}°C.`;
      } else {
        action = 'idle';
        reasoning +=
          `Indoor temp ${indoorTemp}°C is within acceptable range of target ${targetTemp}°C.`;
      }
    }

    return {
      action: action as 'heating' | 'cooling' | 'idle' | 'off',
      confidence: 0.7, // Lower confidence for rule-based decisions
      reasoning,
      factors: ['temperature_differential', 'system_mode', 'fallback_logic'],
      energyImpact: action === 'idle' ? 'low' : 'medium',
      comfortImpact: 'medium',
      source: 'fallback',
      executionTimeMs: 0,
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }

  /**
   * Check if AI engine is available and healthy
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    details: {
      enabled: boolean;
      apiKeyConfigured: boolean;
      modelAccessible: boolean;
      lastError?: string;
    };
  }> {
    const details = {
      enabled: this.isEnabled,
      apiKeyConfigured: !!this.config.openaiApiKey,
      modelAccessible: false,
      lastError: undefined as string | undefined,
    };

    if (this.isEnabled) {
      try {
        // Simple test call to verify model access
        const testResponse = await this.chatModel.invoke([
          new HumanMessage(
            'Respond with "OK" if you can receive this message.',
          ),
        ]);

        details.modelAccessible = testResponse.content.toString().includes(
          'OK',
        );
      } catch (error) {
        details.lastError = error instanceof Error
          ? error.message
          : String(error);
      }
    }

    return {
      healthy: details.enabled && details.apiKeyConfigured &&
        details.modelAccessible,
      details,
    };
  }

  /**
   * Get configuration info
   */
  getConfig(): Partial<AIDecisionConfig> {
    return {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      enabled: this.isEnabled,
      fallbackToRules: this.fallbackToRules,
    };
  }
}
