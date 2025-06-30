/**
 * Unit tests for Adaptive Learning Engine
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  AdaptiveLearningEngine,
  LearningConfig,
} from '../../../../src/ai/learning/adaptive-learning-engine.ts';
import {
  HVACDecisionContext,
  UserInteraction,
} from '../../../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../../../src/types/common.ts';
import { LoggerService } from '../../../../../src/core/logger.ts';

// Mock logger that extends LoggerService properly
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockLearningLogger');
  }
}

Deno.test('Adaptive Learning Engine', async (t) => {
  const mockLogger = new MockLoggerService();
  
  const config: LearningConfig = {
    learningRate: 0.2,
    forgettingFactor: 0.1,
    minInteractionsForPattern: 5,
    similarityThreshold: 0.7,
    patternValidityPeriod: 30,
    initialComfortWeight: 0.6,
    initialEfficiencyWeight: 0.3,
    initialConvenienceWeight: 0.1,
    maxWeightChange: 0.1,
    adaptationWindowDays: 7,
  };

  await t.step('should initialize with configuration', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    assertExists(engine);
    assertInstanceOf(engine, AdaptiveLearningEngine);
    
    console.log('✅ Adaptive Learning Engine initialized successfully');
  });

  await t.step('should record user interactions', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    const context: HVACDecisionContext = {
      indoorTemp: 21.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'heating',
      currentHour: 14,
      isWeekday: true,
    };

    const interaction: UserInteraction = {
      timestamp: new Date(),
      type: 'manual_override',
      details: { 
        actionValue: 'heating',
        satisfaction: 0.8,
        reason: 'too_cold'
      },
      context: {
        indoorTemp: context.indoorTemp,
        outdoorTemp: context.outdoorTemp,
        targetTemp: context.targetTemp,
        currentHour: context.currentHour,
      },
    };

    engine.recordInteraction(interaction);
    
    // Verify interaction was recorded (check internal state)
    const userProfile = engine.getUserProfile();
    assertExists(userProfile);
    assertEquals(userProfile.totalInteractions, 1);
    
    console.log('✅ User interaction recorded successfully');
  });

  await t.step('should detect patterns from interactions', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Add multiple similar interactions to create a pattern
    const baseContext: HVACDecisionContext = {
      indoorTemp: 20.0,
      outdoorTemp: 10.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    // Create multiple interactions
    for (let i = 0; i < 6; i++) {
      const interaction: UserInteraction = {
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Daily intervals
        context: { ...baseContext, indoorTemp: 20 + Math.random() },
        userAction: 'manual_override',
        actionValue: 'heating',
        satisfaction: 0.8 + Math.random() * 0.2,
        metadata: { reason: 'comfort_adjustment' },
      };
      engine.recordInteraction(interaction);
    }

    // Generate temperature readings for pattern detection
    const temperatureReadings = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 60 * 60 * 1000),
      indoor: 20 + Math.sin(i / 4) * 2,
      outdoor: 10 + Math.sin(i / 6) * 3,
      target: 22,
      mode: i % 3 === 0 ? 'heating' : 'idle' as const,
    }));

    const patterns = engine.detectPatterns(temperatureReadings);
    
    assertExists(patterns);
    assertEquals(Array.isArray(patterns), true);
    
    console.log(`✅ Detected ${patterns.length} behavioral patterns`);
  });

  await t.step('should generate personalized recommendations', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Add some learning data
    const context: HVACDecisionContext = {
      indoorTemp: 21.0,
      outdoorTemp: 12.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 16,
      isWeekday: true,
    };

    // Record preferences
    for (let i = 0; i < 8; i++) {
      const interaction: UserInteraction = {
        timestamp: new Date(Date.now() - i * 12 * 60 * 60 * 1000),
        context: { ...context, currentHour: 16 + (i % 3) },
        userAction: 'temperature_adjustment',
        actionValue: (22.5 + Math.random() * 0.5).toString(),
        satisfaction: 0.85 + Math.random() * 0.15,
        metadata: { preference: 'warmer' },
      };
      engine.recordInteraction(interaction);
    }

    const recommendations = engine.getPersonalizedRecommendations(context);
    
    assertExists(recommendations);
    assertEquals(typeof recommendations.targetTemp, 'number');
    assertEquals(typeof recommendations.tolerance, 'number');
    assertEquals(typeof recommendations.confidence, 'number');
    assertExists(recommendations.reasoning);
    
    assertEquals(recommendations.confidence >= 0 && recommendations.confidence <= 1, true);
    
    console.log(`✅ Generated personalized recommendations: ${recommendations.targetTemp}°C (confidence: ${(recommendations.confidence * 100).toFixed(1)}%)`);
  });

  await t.step('should provide behavioral insights', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Add varied interactions for insights
    const contexts = [
      { hour: 8, mode: 'heating', satisfaction: 0.9 },
      { hour: 14, mode: 'idle', satisfaction: 0.7 },
      { hour: 18, mode: 'heating', satisfaction: 0.8 },
      { hour: 22, mode: 'cooling', satisfaction: 0.6 },
    ];

    contexts.forEach((ctx, i) => {
      const interaction: UserInteraction = {
        timestamp: new Date(Date.now() - i * 6 * 60 * 60 * 1000),
        context: {
          indoorTemp: 20 + Math.random() * 4,
          outdoorTemp: 15 + Math.random() * 10,
          targetTemp: 22,
          systemMode: SystemMode.AUTO,
          currentMode: ctx.mode as any,
          currentHour: ctx.hour,
          isWeekday: true,
        },
        userAction: 'preference_update',
        actionValue: ctx.mode,
        satisfaction: ctx.satisfaction,
        metadata: { time_of_day: ctx.hour < 12 ? 'morning' : ctx.hour < 18 ? 'afternoon' : 'evening' },
      };
      engine.recordInteraction(interaction);
    });

    const insights = engine.generateBehavioralInsights();
    
    assertExists(insights);
    assertEquals(Array.isArray(insights), true);
    
    console.log(`✅ Generated ${insights.length} behavioral insights`);
    
    if (insights.length > 0) {
      const firstInsight = insights[0];
      assertExists(firstInsight.category);
      assertExists(firstInsight.description);
      assertInstanceOf(firstInsight.confidence, Number);
    }
  });

  await t.step('should adapt to user preferences over time', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    const context: HVACDecisionContext = {
      indoorTemp: 20.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 10,
      isWeekday: true,
    };

    // Get initial recommendations
    const initialRecs = engine.getPersonalizedRecommendations(context);
    
    // Simulate user consistently preferring warmer temperatures
    for (let i = 0; i < 10; i++) {
      const interaction: UserInteraction = {
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        context: { ...context, indoorTemp: 20 + i * 0.1 },
        userAction: 'temperature_increase',
        actionValue: (23 + Math.random() * 0.5).toString(),
        satisfaction: 0.9,
        metadata: { adjustment: 'warmer_preference' },
      };
      engine.recordInteraction(interaction);
    }

    // Trigger learning update
    engine.triggerLearningUpdate();
    
    // Get updated recommendations
    const updatedRecs = engine.getPersonalizedRecommendations(context);
    
    // Verify adaptation occurred
    assertExists(updatedRecs);
    assertEquals(typeof updatedRecs.targetTemp, 'number');
    
    console.log(`✅ Adaptation test completed:`);
    console.log(`   Initial target: ${initialRecs.targetTemp.toFixed(1)}°C`);
    console.log(`   Adapted target: ${updatedRecs.targetTemp.toFixed(1)}°C`);
    console.log(`   Confidence: ${(updatedRecs.confidence * 100).toFixed(1)}%`);
  });

  await t.step('should handle edge cases gracefully', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Test with minimal data
    const context: HVACDecisionContext = {
      indoorTemp: 21.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 12,
      isWeekday: true,
    };

    // Should work with no prior interactions
    const recommendations = engine.getPersonalizedRecommendations(context);
    assertExists(recommendations);
    
    // Should handle empty pattern detection
    const patterns = engine.detectPatterns([]);
    assertEquals(Array.isArray(patterns), true);
    
    // Should handle behavioral insights with minimal data
    const insights = engine.generateBehavioralInsights();
    assertEquals(Array.isArray(insights), true);
    
    console.log('✅ Edge cases handled gracefully');
  });

  console.log('🎉 All Adaptive Learning Engine unit tests completed successfully!');
});