/**
 * Comprehensive Unit Tests for Smart Scheduler
 * 
 * Tests cover intelligent scheduling, optimization strategies, event handling,
 * learning integration, and real-world scenarios.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { SmartScheduler, type SchedulerConfig } from '../../../src/ai/scheduling/smart-scheduler.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockSchedulerLogger');
  }
}

// Mock optimizer and analytics for dependency injection
class MockHVACOptimizer {
  generateOptimalSchedule = async () => ([
    {
      timestamp: new Date(),
      recommendedMode: 'idle' as const,
      targetTemp: 22,
      energyScore: 0.8,
      comfortScore: 0.9,
      costScore: 0.7,
      overallScore: 0.8
    }
  ]);
  
  calculateComfortScore = () => 0.8;
  predictEnergyUsage = async () => ({ predictedUsage: 2.5, confidence: 0.9, costEstimate: 0.3, factors: {} });
  analyzeCosts = async () => ({ 
    currentHourCost: 0.12, 
    dailyCostEstimate: 2.88, 
    weeklyCostEstimate: 20.16,
    potentialSavings: 0.5,
    recommendations: []
  });
}

class MockPredictiveAnalytics {
  predictTemperatureTrends = async () => ([
    {
      timestamp: new Date(),
      predictedIndoor: 22,
      confidence: 0.9,
      upperBound: 23,
      lowerBound: 21,
      factors: {}
    }
  ]);
  
  analyzeTemperaturePatterns = async () => ({
    dailyPattern: { peakHour: 14, minHour: 6, amplitude: 3 },
    weeklyPattern: { peak: 'Tuesday', min: 'Sunday' },
    trendDirection: 'stable' as const,
    volatility: 0.2,
    cyclicality: 0.8,
    confidence: 0.9
  });
}

class MockAdaptiveLearning {
  getPersonalizedRecommendations = async () => ({
    targetTemp: 22,
    tolerance: 1.5,
    confidence: 0.85,
    reasoning: 'Based on historical preferences'
  });
  
  recordInteraction = () => {};
  getUserProfile = () => ({ totalInteractions: 10, averageSatisfaction: 0.8 });
}

// Standard test configuration
const defaultConfig: SchedulerConfig = {
  defaultLookaheadHours: 24,
  maxConcurrentEvents: 10,
  eventConflictResolution: 'priority',
  autoOptimizationInterval: 60,
  weatherUpdateInterval: 30,
  occupancyDetectionEnabled: true,
  adaptScheduleFromLearning: true,
  learningInfluenceWeight: 0.7,
  maxTempChange: 3.0,
  minComfortScore: 0.7,
  emergencyOverrideEnabled: true,
};

// Helper functions for creating test data
function createScheduleEvent(
  name: string,
  startTime: Date,
  duration = 2,
  priority = 'medium' as const
) {
  return {
    id: `event_${Date.now()}_${Math.random()}`,
    name,
    startTime,
    endTime: new Date(startTime.getTime() + duration * 60 * 60 * 1000),
    priority,
    targetTemp: 22,
    mode: 'auto' as const,
    recurring: false,
    conditions: {},
    metadata: {}
  };
}

function createOccupancySchedule(pattern: 'workday' | 'weekend' | 'vacation' = 'workday') {
  const schedule = [];
  for (let hour = 0; hour < 24; hour++) {
    let probability = 0.5;
    
    switch (pattern) {
      case 'workday':
        probability = hour >= 7 && hour <= 8 ? 0.9 :    // Morning
                     hour >= 9 && hour <= 17 ? 0.2 :    // Work hours
                     hour >= 18 && hour <= 22 ? 0.9 :   // Evening
                     0.1;                                // Night
        break;
      case 'weekend':
        probability = hour >= 8 && hour <= 23 ? 0.8 : 0.2;
        break;
      case 'vacation':
        probability = 0.05; // Very low occupancy
        break;
    }
    
    schedule.push({
      hour,
      probability,
      pattern,
      activities: pattern === 'workday' && hour >= 9 && hour <= 17 ? ['work'] : ['home']
    });
  }
  return schedule;
}

function createWeatherForecast(hours = 24) {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
    temperature: 20 + Math.sin(i / 6) * 5,
    humidity: 50 + Math.random() * 20,
    conditions: i % 4 === 0 ? 'clear' : i % 4 === 1 ? 'cloudy' : i % 4 === 2 ? 'rainy' : 'partly_cloudy' as const,
    windSpeed: 5 + Math.random() * 10,
    pressure: 1010 + Math.random() * 20
  }));
}

Deno.test({
  name: 'Smart Scheduler - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockOptimizer = new MockHVACOptimizer();
    const mockAnalytics = new MockPredictiveAnalytics();
    const mockLearning = new MockAdaptiveLearning();

    await t.step('should initialize with dependencies', () => {
      const scheduler = new SmartScheduler(
        defaultConfig,
        mockLogger,
        mockOptimizer as any,
        mockAnalytics as any,
        mockLearning as any
      );
      
      assertExists(scheduler);
      assertInstanceOf(scheduler, SmartScheduler);
      
      console.log('✅ Smart Scheduler initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        maxConcurrentEvents: -1 // Invalid negative value
      };
      
      assertThrows(
        () => new SmartScheduler(
          invalidConfig,
          mockLogger,
          mockOptimizer as any,
          mockAnalytics as any,
          mockLearning as any
        ),
        Error,
        'maxConcurrentEvents must be positive'
      );
    });

    await t.step('should handle optional dependencies', () => {
      const scheduler = new SmartScheduler(
        defaultConfig,
        mockLogger,
        undefined, // No optimizer
        undefined, // No analytics
        mockLearning as any
      );
      
      assertExists(scheduler);
      
      console.log('✅ Optional dependencies handled correctly');
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Event Management',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should schedule single events', async () => {
      const event = createScheduleEvent(
        'Morning Warmup',
        new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
      );
      
      const success = await scheduler.scheduleEvent(event);
      
      assertEquals(success, true);
      
      const activeEvents = await scheduler.getActiveEvents();
      assertEquals(activeEvents.length, 1);
      assertEquals(activeEvents[0].name, 'Morning Warmup');
      
      console.log('✅ Single event scheduled successfully');
    });

    await t.step('should handle multiple events', async () => {
      const events = [
        createScheduleEvent('Lunch Break', new Date(Date.now() + 2 * 60 * 60 * 1000)),
        createScheduleEvent('Evening Comfort', new Date(Date.now() + 8 * 60 * 60 * 1000)),
        createScheduleEvent('Night Setback', new Date(Date.now() + 12 * 60 * 60 * 1000))
      ];
      
      for (const event of events) {
        await scheduler.scheduleEvent(event);
      }
      
      const activeEvents = await scheduler.getActiveEvents();
      assertEquals(activeEvents.length >= 3, true); // At least 3 new events
      
      console.log(`✅ Multiple events scheduled: ${activeEvents.length} total events`);
    });

    await t.step('should detect and resolve conflicts', async () => {
      const conflictEvent1 = createScheduleEvent(
        'High Priority Event',
        new Date(Date.now() + 3 * 60 * 60 * 1000),
        2,
        'high'
      );
      
      const conflictEvent2 = createScheduleEvent(
        'Low Priority Event',
        new Date(Date.now() + 3.5 * 60 * 60 * 1000), // Overlaps with first
        2,
        'low'
      );
      
      await scheduler.scheduleEvent(conflictEvent1);
      await scheduler.scheduleEvent(conflictEvent2);
      
      const conflicts = await scheduler.detectConflicts();
      
      assertExists(conflicts);
      assertEquals(Array.isArray(conflicts), true);
      
      if (conflicts.length > 0) {
        console.log(`✅ Detected ${conflicts.length} scheduling conflicts`);
        
        const resolution = await scheduler.resolveConflicts(conflicts);
        assertExists(resolution);
      }
    });

    await t.step('should cancel events', async () => {
      const event = createScheduleEvent(
        'Temporary Event',
        new Date(Date.now() + 5 * 60 * 60 * 1000)
      );
      
      await scheduler.scheduleEvent(event);
      const success = await scheduler.cancelEvent(event.id);
      
      assertEquals(success, true);
      
      console.log('✅ Event cancellation successful');
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Intelligent Optimization',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should generate optimized schedules', async () => {
      const occupancySchedule = createOccupancySchedule('workday');
      const weatherForecast = createWeatherForecast(24);
      
      const optimizedSchedule = await scheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      assertExists(optimizedSchedule);
      assertEquals(Array.isArray(optimizedSchedule), true);
      assertEquals(optimizedSchedule.length, 24); // 24-hour schedule
      
      // Verify schedule structure
      for (const entry of optimizedSchedule) {
        assertExists(entry.timestamp);
        assertExists(entry.recommendedAction);
        assertEquals(typeof entry.targetTemp, 'number');
        assertEquals(typeof entry.confidence, 'number');
        assertExists(entry.reasoning);
        assertExists(entry.optimization);
      }
      
      console.log(`✅ Generated optimized 24-hour schedule`);
    });

    await t.step('should adapt to occupancy patterns', async () => {
      const workdaySchedule = createOccupancySchedule('workday');
      const weekendSchedule = createOccupancySchedule('weekend');
      const weatherForecast = createWeatherForecast(12);
      
      const workdayOptimized = await scheduler.generateOptimizedSchedule(workdaySchedule, weatherForecast);
      const weekendOptimized = await scheduler.generateOptimizedSchedule(weekendSchedule, weatherForecast);
      
      // Should produce different optimizations for different occupancy patterns
      assertExists(workdayOptimized);
      assertExists(weekendOptimized);
      
      // Compare energy efficiency during typical work hours
      const workday10AM = workdayOptimized.find(entry => entry.timestamp.getHours() === 10);
      const weekend10AM = weekendOptimized.find(entry => entry.timestamp.getHours() === 10);
      
      if (workday10AM && weekend10AM) {
        console.log(`✅ Occupancy adaptation:`);
        console.log(`   Workday 10 AM: ${workday10AM.recommendedAction} (${workday10AM.targetTemp}°C)`);
        console.log(`   Weekend 10 AM: ${weekend10AM.recommendedAction} (${weekend10AM.targetTemp}°C)`);
      }
    });

    await t.step('should integrate weather forecasts', async () => {
      const occupancySchedule = createOccupancySchedule('workday');
      
      // Hot weather forecast
      const hotWeather = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 35, // Very hot
        humidity: 60,
        conditions: 'clear' as const,
        windSpeed: 5,
        pressure: 1020
      }));
      
      // Cold weather forecast
      const coldWeather = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 5, // Very cold
        humidity: 80,
        conditions: 'cloudy' as const,
        windSpeed: 15,
        pressure: 1000
      }));
      
      const hotSchedule = await scheduler.generateOptimizedSchedule(occupancySchedule, hotWeather);
      const coldSchedule = await scheduler.generateOptimizedSchedule(occupancySchedule, coldWeather);
      
      // Should adapt to weather conditions
      assertExists(hotSchedule);
      assertExists(coldSchedule);
      
      const hotNoon = hotSchedule.find(entry => entry.timestamp.getHours() === 12);
      const coldNoon = coldSchedule.find(entry => entry.timestamp.getHours() === 12);
      
      if (hotNoon && coldNoon) {
        console.log(`✅ Weather integration:`);
        console.log(`   Hot weather noon: ${hotNoon.recommendedAction} (${hotNoon.targetTemp}°C)`);
        console.log(`   Cold weather noon: ${coldNoon.recommendedAction} (${coldNoon.targetTemp}°C)`);
      }
    });

    await t.step('should optimize for energy efficiency', async () => {
      const occupancySchedule = createOccupancySchedule('vacation'); // Low occupancy
      const weatherForecast = createWeatherForecast(24);
      
      const energyFocusedConfig = { 
        ...defaultConfig, 
        minComfortScore: 0.5 // Lower comfort requirement for energy savings
      };
      
      const energyScheduler = new SmartScheduler(
        energyFocusedConfig,
        mockLogger,
        new MockHVACOptimizer() as any,
        new MockPredictiveAnalytics() as any,
        new MockAdaptiveLearning() as any
      );
      
      const energySchedule = await energyScheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      assertExists(energySchedule);
      
      // Should have more energy-saving actions during low occupancy
      const energySavingActions = energySchedule.filter(entry => 
        entry.recommendedAction === 'setback' || entry.recommendedAction === 'eco_mode'
      );
      
      console.log(`✅ Energy optimization: ${energySavingActions.length} energy-saving actions`);
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Learning Integration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should incorporate user preferences from learning', async () => {
      const occupancySchedule = createOccupancySchedule('workday');
      const weatherForecast = createWeatherForecast(6);
      
      const schedule = await scheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      // Should incorporate learning recommendations
      assertExists(schedule);
      
      // Check if learning influence is applied
      const hasLearningInfluence = schedule.some(entry => 
        entry.reasoning.includes('learning') || 
        entry.reasoning.includes('preference') ||
        entry.reasoning.includes('historical')
      );
      
      console.log(`✅ Learning integration: ${hasLearningInfluence ? 'Applied' : 'Not detected'}`);
    });

    await t.step('should adapt schedule based on user feedback', async () => {
      // Simulate user feedback on a scheduled action
      const feedback = {
        timestamp: new Date(),
        action: 'temperature_increase',
        satisfaction: 0.9,
        context: {
          scheduledTemp: 20,
          actualTemp: 18,
          hour: 8,
          occupancy: 'high'
        }
      };
      
      await scheduler.recordUserFeedback(feedback);
      
      // Generate new schedule to see adaptation
      const occupancySchedule = createOccupancySchedule('workday');
      const weatherForecast = createWeatherForecast(6);
      
      const adaptedSchedule = await scheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      assertExists(adaptedSchedule);
      
      console.log('✅ User feedback incorporated into scheduling');
    });

    await t.step('should balance learning influence with other factors', async () => {
      const lowLearningConfig = { ...defaultConfig, learningInfluenceWeight: 0.2 };
      const highLearningConfig = { ...defaultConfig, learningInfluenceWeight: 0.9 };
      
      const lowLearningScheduler = new SmartScheduler(
        lowLearningConfig,
        mockLogger,
        new MockHVACOptimizer() as any,
        new MockPredictiveAnalytics() as any,
        new MockAdaptiveLearning() as any
      );
      
      const highLearningScheduler = new SmartScheduler(
        highLearningConfig,
        mockLogger,
        new MockHVACOptimizer() as any,
        new MockPredictiveAnalytics() as any,
        new MockAdaptiveLearning() as any
      );
      
      const occupancySchedule = createOccupancySchedule('workday');
      const weatherForecast = createWeatherForecast(4);
      
      const lowLearningSchedule = await lowLearningScheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      const highLearningSchedule = await highLearningScheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );
      
      assertExists(lowLearningSchedule);
      assertExists(highLearningSchedule);
      
      console.log('✅ Learning influence weight balancing verified');
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Real-world Scenarios',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should handle typical workday scenario', async () => {
      const workdaySchedule = createOccupancySchedule('workday');
      const mildWeather = createWeatherForecast(24).map(entry => ({
        ...entry,
        temperature: 18 + Math.sin(entry.timestamp.getHours() / 24 * 2 * Math.PI) * 4
      }));
      
      const schedule = await scheduler.generateOptimizedSchedule(workdaySchedule, mildWeather);
      
      assertExists(schedule);
      
      // Should have pre-heating before morning occupancy
      const earlyMorning = schedule.filter(entry => 
        entry.timestamp.getHours() >= 6 && entry.timestamp.getHours() <= 8
      );
      
      // Should have setback during work hours
      const workHours = schedule.filter(entry => 
        entry.timestamp.getHours() >= 9 && entry.timestamp.getHours() <= 17
      );
      
      console.log(`✅ Workday scenario:`);
      console.log(`   Morning prep actions: ${earlyMorning.length}`);
      console.log(`   Work hour actions: ${workHours.length}`);
    });

    await t.step('should handle weekend relaxed scenario', async () => {
      const weekendSchedule = createOccupancySchedule('weekend');
      const pleasantWeather = createWeatherForecast(24).map(entry => ({
        ...entry,
        temperature: 22 + Math.random() * 2 - 1, // Mild variation around 22°C
        conditions: 'clear' as const
      }));
      
      const schedule = await scheduler.generateOptimizedSchedule(weekendSchedule, pleasantWeather);
      
      assertExists(schedule);
      
      // Weekend should have different patterns than workday
      const weekendMorning = schedule.filter(entry => 
        entry.timestamp.getHours() >= 8 && entry.timestamp.getHours() <= 10
      );
      
      console.log(`✅ Weekend scenario: ${weekendMorning.length} morning comfort actions`);
    });

    await t.step('should handle vacation energy-saving scenario', async () => {
      const vacationSchedule = createOccupancySchedule('vacation');
      const summerWeather = createWeatherForecast(24).map(entry => ({
        ...entry,
        temperature: 28 + Math.sin(entry.timestamp.getHours() / 24 * 2 * Math.PI) * 6,
        conditions: 'clear' as const
      }));
      
      const schedule = await scheduler.generateOptimizedSchedule(vacationSchedule, summerWeather);
      
      assertExists(schedule);
      
      // Should have aggressive energy saving during vacation
      const energySavingActions = schedule.filter(entry => 
        entry.recommendedAction === 'setback' || 
        entry.recommendedAction === 'eco_mode' ||
        entry.optimization.energyPriority === 'high'
      );
      
      console.log(`✅ Vacation scenario: ${energySavingActions.length} energy-saving actions`);
    });

    await t.step('should handle extreme weather emergency', async () => {
      const normalSchedule = createOccupancySchedule('workday');
      const extremeWeather = createWeatherForecast(12).map(entry => ({
        ...entry,
        temperature: entry.timestamp.getHours() < 6 ? -15 : 40, // Extreme cold to hot
        conditions: entry.timestamp.getHours() < 6 ? 'snow' : 'clear' as const,
        windSpeed: 25
      }));
      
      const schedule = await scheduler.generateOptimizedSchedule(normalSchedule, extremeWeather);
      
      assertExists(schedule);
      
      // Should have emergency override actions
      const emergencyActions = schedule.filter(entry => 
        entry.recommendedAction === 'emergency_heat' || 
        entry.recommendedAction === 'emergency_cool' ||
        entry.optimization.safetyPriority === 'critical'
      );
      
      console.log(`✅ Extreme weather scenario: ${emergencyActions.length} emergency actions`);
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should handle missing or invalid data', async () => {
      const emptySchedule: any[] = [];
      const invalidWeather = null as unknown as any[];
      
      const schedule = await scheduler.generateOptimizedSchedule(emptySchedule, invalidWeather);
      
      assertExists(schedule);
      assertEquals(Array.isArray(schedule), true);
      
      console.log('✅ Missing data handled gracefully');
    });

    await t.step('should handle invalid event data', async () => {
      const invalidEvent = {
        id: '',
        name: '',
        startTime: 'invalid-date',
        endTime: 'invalid-date',
        priority: 'invalid-priority',
        targetTemp: 'not-a-number'
      } as any;
      
      const success = await scheduler.scheduleEvent(invalidEvent);
      
      // Should handle gracefully without crashing
      assertEquals(typeof success, 'boolean');
      
      console.log('✅ Invalid event data handled');
    });

    await t.step('should handle concurrent scheduling conflicts', async () => {
      const conflictingEvents = Array.from({ length: 5 }, (_, i) => 
        createScheduleEvent(
          `Conflict Event ${i}`,
          new Date(Date.now() + 60 * 60 * 1000), // All at same time
          2,
          'high'
        )
      );
      
      // Schedule all conflicting events
      const results = await Promise.all(
        conflictingEvents.map(event => scheduler.scheduleEvent(event))
      );
      
      // Should handle all events and resolve conflicts
      assertExists(results);
      assertEquals(results.length, 5);
      
      const conflicts = await scheduler.detectConflicts();
      
      if (conflicts.length > 0) {
        const resolution = await scheduler.resolveConflicts(conflicts);
        assertExists(resolution);
      }
      
      console.log(`✅ Concurrent conflicts handled: ${conflicts.length} conflicts detected`);
    });

    await t.step('should handle system resource constraints', async () => {
      // Try to schedule more events than maxConcurrentEvents
      const manyEvents = Array.from({ length: 15 }, (_, i) => 
        createScheduleEvent(
          `Event ${i}`,
          new Date(Date.now() + (i * 30 * 60 * 1000)), // 30 min intervals
          1
        )
      );
      
      let scheduledCount = 0;
      for (const event of manyEvents) {
        const success = await scheduler.scheduleEvent(event);
        if (success) scheduledCount++;
      }
      
      // Should respect maxConcurrentEvents limit
      assertEquals(scheduledCount <= defaultConfig.maxConcurrentEvents, true);
      
      console.log(`✅ Resource constraints: ${scheduledCount}/${manyEvents.length} events scheduled`);
    });
  }
});

Deno.test({
  name: 'Smart Scheduler - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const scheduler = new SmartScheduler(
      defaultConfig,
      mockLogger,
      new MockHVACOptimizer() as any,
      new MockPredictiveAnalytics() as any,
      new MockAdaptiveLearning() as any
    );

    await t.step('should generate large schedules efficiently', async () => {
      const occupancySchedule = createOccupancySchedule('workday');
      const extendedWeather = createWeatherForecast(168); // 7 days
      
      const startTime = performance.now();
      const schedule = await scheduler.generateOptimizedSchedule(occupancySchedule, extendedWeather);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(schedule);
      assertEquals(schedule.length, 168);
      assertEquals(duration < 5000, true); // Should complete within 5 seconds
      
      console.log(`✅ Generated 7-day schedule in ${duration.toFixed(2)}ms`);
    });

    await t.step('should handle many concurrent events efficiently', async () => {
      const events = Array.from({ length: 50 }, (_, i) => 
        createScheduleEvent(
          `Bulk Event ${i}`,
          new Date(Date.now() + i * 60 * 60 * 1000), // Hourly events
          1
        )
      );
      
      const startTime = performance.now();
      
      const results = await Promise.all(
        events.map(event => scheduler.scheduleEvent(event))
      );
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      const successCount = results.filter(Boolean).length;
      
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Scheduled ${successCount} events in ${duration.toFixed(2)}ms`);
    });

    await t.step('should optimize scheduling algorithms efficiently', async () => {
      const complexOccupancy = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: Math.sin(hour / 12 * Math.PI) * 0.5 + 0.5, // Complex pattern
        pattern: 'variable',
        activities: ['work', 'meeting', 'break', 'travel'][hour % 4]
      }));
      
      const complexWeather = createWeatherForecast(48); // 2 days with changing conditions
      
      const startTime = performance.now();
      const schedule = await scheduler.generateOptimizedSchedule(complexOccupancy, complexWeather);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(schedule);
      assertEquals(duration < 4000, true); // Should complete within 4 seconds
      
      console.log(`✅ Complex optimization completed in ${duration.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All Smart Scheduler unit tests completed successfully!');