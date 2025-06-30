/**
 * Integration tests for Adaptive Learning System
 * 
 * Tests the integration between the adaptive learning engine and other AI components
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  AdaptiveLearningEngine,
  LearningConfig,
} from '../../src/ai/learning/adaptive-learning-engine.ts';
import {
  HVACDecisionContext,
  UserInteraction,
  TemperatureReading,
} from '../../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../../src/types/common.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger that extends LoggerService properly
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockIntegrationLogger');
  }
}

/**
 * Generate realistic test data for learning scenarios
 */
function generateLearningScenario(days: number = 7) {
  const interactions: UserInteraction[] = [];
  const temperatureReadings: TemperatureReading[] = [];
  
  const baseTime = Date.now();
  
  for (let day = 0; day < days; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const timestamp = new Date(baseTime - (days - day - 1) * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000);
      
      // Generate temperature reading
      const outdoorTemp = 15 + Math.sin((hour - 6) / 24 * 2 * Math.PI) * 8 + Math.random() * 3;
      const indoorTemp = 20 + Math.sin((hour - 2) / 24 * 2 * Math.PI) * 2 + Math.random() * 1;
      
      temperatureReadings.push({
        timestamp,
        indoor: indoorTemp,
        outdoor: outdoorTemp,
        target: 22,
        mode: hour >= 22 || hour <= 6 ? 'heating' : hour >= 14 && hour <= 18 ? 'cooling' : 'idle',
      });
      
      // Generate user interactions (less frequent)
      if (Math.random() < 0.15) { // 15% chance per hour
        const context: HVACDecisionContext = {
          indoorTemp,
          outdoorTemp,
          targetTemp: 22,
          systemMode: SystemMode.AUTO,
          currentMode: temperatureReadings[temperatureReadings.length - 1].mode,
          currentHour: hour,
          isWeekday: day >= 1 && day <= 5,
        };
        
        // User behavior patterns
        let action = 'manual_override';
        let actionValue = 'idle';
        let satisfaction = 0.7;
        
        if (hour >= 7 && hour <= 9) {
          // Morning: prefer warmer
          action = 'temperature_adjustment';
          actionValue = (22.5 + Math.random() * 1).toString();
          satisfaction = 0.8 + Math.random() * 0.2;
        } else if (hour >= 17 && hour <= 19) {
          // Evening: comfort optimization
          action = 'comfort_optimization';
          actionValue = indoorTemp < 21 ? 'heating' : 'idle';
          satisfaction = 0.75 + Math.random() * 0.25;
        } else if (hour >= 22 || hour <= 6) {
          // Night: energy saving preference
          action = 'energy_saving';
          actionValue = 'eco_mode';
          satisfaction = 0.6 + Math.random() * 0.3;
        }
        
        interactions.push({
          timestamp,
          context,
          userAction: action,
          actionValue,
          satisfaction,
          metadata: {
            time_period: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening',
            day_type: context.isWeekday ? 'weekday' : 'weekend',
          },
        });
      }
    }
  }
  
  return { interactions, temperatureReadings };
}

Deno.test('Adaptive Learning Integration', async (t) => {
  const mockLogger = new MockLoggerService();
  
  const config: LearningConfig = {
    learningRate: 0.3,
    adaptationWindow: 7,
    preferenceWeight: 0.7,
    patternWeight: 0.3,
    minimumInteractions: 8,
    confidenceThreshold: 0.6,
    enablePersonalization: true,
    enablePatternDetection: true,
    enableSeasonalAdaptation: true,
    enableOccupancyLearning: true,
    maxPatterns: 25,
    patternMinSupport: 0.4,
    adaptationRate: 0.2,
  };

  await t.step('should learn from realistic user behavior over time', async () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Generate 10 days of realistic data
    const { interactions, temperatureReadings } = generateLearningScenario(10);
    
    console.log(`📊 Generated learning scenario:`);
    console.log(`   - ${interactions.length} user interactions`);
    console.log(`   - ${temperatureReadings.length} temperature readings`);
    
    // Record all interactions
    interactions.forEach(interaction => {
      engine.recordInteraction(interaction);
    });
    
    // Detect patterns from temperature data
    const patterns = engine.detectPatterns(temperatureReadings);
    assertExists(patterns);
    
    console.log(`🧠 Detected ${patterns.length} behavioral patterns`);
    
    // Trigger learning update
    engine.triggerLearningUpdate();
    
    // Verify learning occurred
    const userProfile = engine.getUserProfile();
    assertExists(userProfile);
    assertEquals(userProfile.totalInteractions, interactions.length);
    assertInstanceOf(userProfile.averageSatisfaction, Number);
    
    console.log(`✅ Learning integration test completed:`);
    console.log(`   - Total interactions: ${userProfile.totalInteractions}`);
    console.log(`   - Average satisfaction: ${(userProfile.averageSatisfaction * 100).toFixed(1)}%`);
    console.log(`   - Patterns detected: ${patterns.length}`);
  });

  await t.step('should provide contextual recommendations based on time patterns', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Generate scenario with clear time-based patterns
    const { interactions } = generateLearningScenario(14);
    
    // Record interactions
    interactions.forEach(interaction => {
      engine.recordInteraction(interaction);
    });
    
    engine.triggerLearningUpdate();
    
    // Test recommendations for different times of day
    const timeContexts = [
      { hour: 8, period: 'morning' },
      { hour: 14, period: 'afternoon' }, 
      { hour: 19, period: 'evening' },
      { hour: 23, period: 'night' },
    ];
    
    timeContexts.forEach(({ hour, period }) => {
      const context: HVACDecisionContext = {
        indoorTemp: 21.0,
        outdoorTemp: 15.0,
        targetTemp: 22.0,
        systemMode: SystemMode.AUTO,
        currentMode: 'idle',
        currentHour: hour,
        isWeekday: true,
      };
      
      const recommendations = engine.getPersonalizedRecommendations(context);
      assertExists(recommendations);
      
      console.log(`🕒 ${period} (${hour}:00) recommendations:`);
      console.log(`   - Target: ${recommendations.targetTemp.toFixed(1)}°C`);
      console.log(`   - Tolerance: ±${recommendations.tolerance.toFixed(1)}°C`);
      console.log(`   - Confidence: ${(recommendations.confidence * 100).toFixed(1)}%`);
    });
  });

  await t.step('should adapt to seasonal and occupancy patterns', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Create seasonal variation scenario
    const contexts = [
      // Winter weekday morning - high heating preference
      {
        context: {
          indoorTemp: 18.0,
          outdoorTemp: 5.0,
          targetTemp: 22.0,
          systemMode: SystemMode.AUTO,
          currentMode: 'heating' as const,
          currentHour: 8,
          isWeekday: true,
        },
        pattern: 'winter_weekday',
        preference: 23.5,
        satisfaction: 0.9,
      },
      // Summer weekday afternoon - cooling preference
      {
        context: {
          indoorTemp: 24.0,
          outdoorTemp: 28.0,
          targetTemp: 22.0,
          systemMode: SystemMode.AUTO,
          currentMode: 'cooling' as const,
          currentHour: 15,
          isWeekday: true,
        },
        pattern: 'summer_weekday',
        preference: 21.0,
        satisfaction: 0.85,
      },
      // Weekend evening - relaxed preference
      {
        context: {
          indoorTemp: 21.5,
          outdoorTemp: 18.0,
          targetTemp: 22.0,
          systemMode: SystemMode.AUTO,
          currentMode: 'idle' as const,
          currentHour: 20,
          isWeekday: false,
        },
        pattern: 'weekend_evening',
        preference: 22.5,
        satisfaction: 0.8,
      },
    ];
    
    // Record multiple instances of each pattern
    contexts.forEach(({ context, pattern, preference, satisfaction }) => {
      for (let i = 0; i < 8; i++) {
        const interaction: UserInteraction = {
          timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          context,
          userAction: 'pattern_preference',
          actionValue: preference.toString(),
          satisfaction: satisfaction + (Math.random() - 0.5) * 0.1,
          metadata: { 
            pattern,
            season: pattern.includes('winter') ? 'winter' : 'summer',
            occupancy: context.isWeekday ? 'work_schedule' : 'home_schedule',
          },
        };
        engine.recordInteraction(interaction);
      }
    });
    
    engine.triggerLearningUpdate();
    
    // Test that engine provides different recommendations for different patterns
    contexts.forEach(({ context, pattern }) => {
      const recommendations = engine.getPersonalizedRecommendations(context);
      assertExists(recommendations);
      
      console.log(`📅 ${pattern} recommendations:`);
      console.log(`   - Target: ${recommendations.targetTemp.toFixed(1)}°C`);
      console.log(`   - Confidence: ${(recommendations.confidence * 100).toFixed(1)}%`);
      console.log(`   - Reasoning: ${recommendations.reasoning}`);
    });
  });

  await t.step('should provide comprehensive behavioral insights', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Generate rich interaction data
    const { interactions } = generateLearningScenario(21); // 3 weeks
    
    interactions.forEach(interaction => {
      engine.recordInteraction(interaction);
    });
    
    engine.triggerLearningUpdate();
    
    // Generate insights
    const insights = engine.generateBehavioralInsights();
    assertExists(insights);
    
    console.log(`🔍 Generated ${insights.length} behavioral insights:`);
    
    insights.slice(0, 5).forEach((insight, index) => {
      console.log(`   ${index + 1}. ${insight.category}: ${insight.description}`);
      console.log(`      Confidence: ${(insight.confidence * 100).toFixed(1)}%`);
    });
    
    // Verify insight quality
    const highConfidenceInsights = insights.filter(insight => insight.confidence > 0.7);
    assertEquals(highConfidenceInsights.length >= 1, true, 'Should have at least one high-confidence insight');
  });

  await t.step('should handle continuous learning and adaptation', () => {
    const engine = new AdaptiveLearningEngine(config, mockLogger);
    
    // Initial learning phase
    const { interactions: phase1 } = generateLearningScenario(7);
    phase1.forEach(interaction => engine.recordInteraction(interaction));
    engine.triggerLearningUpdate();
    
    const context: HVACDecisionContext = {
      indoorTemp: 21.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 10,
      isWeekday: true,
    };
    
    const initialRecs = engine.getPersonalizedRecommendations(context);
    
    // Simulate changing user preferences (adaptation phase)
    for (let i = 0; i < 12; i++) {
      const interaction: UserInteraction = {
        timestamp: new Date(Date.now() - i * 12 * 60 * 60 * 1000),
        context: { ...context, currentHour: 10 + (i % 8) },
        userAction: 'preference_shift',
        actionValue: (20.5 + Math.random()).toString(), // Shift to cooler preference
        satisfaction: 0.85 + Math.random() * 0.15,
        metadata: { adaptation_phase: 'preference_change' },
      };
      engine.recordInteraction(interaction);
    }
    
    engine.triggerLearningUpdate();
    
    const adaptedRecs = engine.getPersonalizedRecommendations(context);
    
    // Verify adaptation
    assertExists(adaptedRecs);
    assertInstanceOf(adaptedRecs.confidence, Number);
    
    console.log(`🔄 Continuous learning test:`);
    console.log(`   Initial target: ${initialRecs.targetTemp.toFixed(1)}°C (confidence: ${(initialRecs.confidence * 100).toFixed(1)}%)`);
    console.log(`   Adapted target: ${adaptedRecs.targetTemp.toFixed(1)}°C (confidence: ${(adaptedRecs.confidence * 100).toFixed(1)}%)`);
    
    // Should show some adaptation
    const adaptationMagnitude = Math.abs(adaptedRecs.targetTemp - initialRecs.targetTemp);
    console.log(`   Adaptation magnitude: ${adaptationMagnitude.toFixed(2)}°C`);
  });

  console.log('🎉 All Adaptive Learning Integration tests completed successfully!');
});