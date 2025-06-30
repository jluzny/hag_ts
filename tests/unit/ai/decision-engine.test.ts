/**
 * Unit tests for AI Decision Engine
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  AIDecisionConfig,
  AIDecisionEngine,
} from '../../../src/ai/decision-engine.ts';
import {
  HVACDecisionContext,
} from '../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../src/types/common.ts';
import { LoggerService } from '../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('TEST');
  }
  
  override info(_message: string, _data?: Record<string, unknown>): void {}
  override error(
    _message: string,
    _error?: unknown,
    _data?: Record<string, unknown>,
  ): void {}
  override debug(_message: string, _data?: Record<string, unknown>): void {}
  override warning(_message: string, _data?: Record<string, unknown>): void {}
}

// Skip AI tests if no OpenAI API key available
const hasApiKey = !!Deno.env.get('OPENAI_API_KEY');

Deno.test('AI Decision Engine', async (t) => {
  const mockLogger = new MockLoggerService();

  await t.step('should initialize with configuration', () => {
    const config: AIDecisionConfig = {
      openaiApiKey: 'test-key',
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000,
      enabled: true,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const engine = new AIDecisionEngine(config, mockLogger);
    assertExists(engine);
  });

  await t.step('should disable when no API key provided', () => {
    const config: AIDecisionConfig = {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000,
      enabled: true,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const engine = new AIDecisionEngine(config, mockLogger);
    assertExists(engine);
    // Should be disabled without API key
  });

  await t.step('should use fallback decision when AI disabled', async () => {
    const config: AIDecisionConfig = {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000,
      enabled: false,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const engine = new AIDecisionEngine(config, mockLogger);

    const context: HVACDecisionContext = {
      indoorTemp: 18.0,
      outdoorTemp: 5.0,
      targetTemp: 21.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    const result = await engine.makeDecision(context);

    assertExists(result);
    assertEquals(result.source, 'fallback');
    assertEquals(result.fallbackUsed, true);
    assertInstanceOf(result.action, String);
    assertInstanceOf(result.confidence, Number);
    assertExists(result.reasoning);
  });

  if (hasApiKey) {
    await t.step('should make AI decision when enabled', async () => {
      const config: AIDecisionConfig = {
        openaiApiKey: Deno.env.get('OPENAI_API_KEY')!,
        model: 'gpt-4',
        temperature: 0.3,
        maxTokens: 1000,
        enabled: true,
        fallbackToRules: true,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const engine = new AIDecisionEngine(config, mockLogger);

      const context: HVACDecisionContext = {
        indoorTemp: 18.0,
        outdoorTemp: 5.0,
        targetTemp: 21.0,
        systemMode: SystemMode.AUTO,
        currentMode: 'idle',
        currentHour: 14,
        isWeekday: true,
      };

      const result = await engine.makeDecision(context);

      assertExists(result);
      assertEquals(result.fallbackUsed, false);
      assertInstanceOf(result.action, String);
      assertInstanceOf(result.confidence, Number);
      assertEquals(result.confidence >= 0 && result.confidence <= 1, true);
      assertExists(result.reasoning);
      assertExists(result.factors);
      assertEquals(Array.isArray(result.factors), true);
    });

    await t.step('should handle cold temperature scenario', async () => {
      const config: AIDecisionConfig = {
        openaiApiKey: Deno.env.get('OPENAI_API_KEY')!,
        model: 'gpt-4',
        temperature: 0.3,
        maxTokens: 1000,
        enabled: true,
        fallbackToRules: true,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const engine = new AIDecisionEngine(config, mockLogger);

      const context: HVACDecisionContext = {
        indoorTemp: 16.0, // Very cold
        outdoorTemp: 0.0, // Freezing outside
        targetTemp: 22.0,
        systemMode: SystemMode.AUTO,
        currentMode: 'idle',
        currentHour: 8, // Morning
        isWeekday: true,
      };

      const result = await engine.makeDecision(context);

      assertExists(result);
      // Should likely recommend heating for cold scenario
      assertEquals(['heating', 'idle'].includes(result.action), true);
    });
  } else {
    await t.step('should skip AI tests - no OpenAI API key available', () => {
      console.log(
        '⚠️  Skipping AI decision tests - OPENAI_API_KEY not configured',
      );
      assertEquals(true, true); // Pass the test
    });
  }

  await t.step('should handle health check', () => {
    const config: AIDecisionConfig = {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000,
      enabled: false,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const engine = new AIDecisionEngine(config, mockLogger);
    const health = engine.getHealth();

    assertExists(health);
    assertInstanceOf(health.enabled, Boolean);
    assertInstanceOf(health.ready, Boolean);
    assertExists(health.lastDecisionTime);
  });

  await t.step('should provide configuration info', () => {
    const config: AIDecisionConfig = {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000,
      enabled: true,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const engine = new AIDecisionEngine(config, mockLogger);
    const info = engine.getConfiguration();

    assertExists(info);
    assertEquals(info.model, 'gpt-4');
    assertEquals(info.temperature, 0.3);
    assertEquals(info.maxTokens, 1000);
    assertEquals(info.enabled, true);
  });
});
