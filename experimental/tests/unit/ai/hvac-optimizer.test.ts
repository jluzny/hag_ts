/**
 * Unit tests for HVAC Optimizer
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  HVACOptimizer,
  OptimizationConfig,
} from '../../src/ai/optimization/hvac-optimizer.ts';
import {
  HVACDecisionContext,
} from '../../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../../src/types/common.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockLogger');
  }
}

Deno.test('HVAC Optimizer', async (t) => {
  const mockLogger = new MockLoggerService();

  await t.step('should initialize with configuration', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.5,
      energyWeight: 0.3,
      costWeight: 0.2,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);
    assertExists(optimizer);
  });

  await t.step('should optimize for comfort priority', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.8, // High comfort priority
      energyWeight: 0.1,
      costWeight: 0.1,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    const context: HVACDecisionContext = {
      indoorTemp: 19.0,
      outdoorTemp: 10.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    const result = await optimizer.optimizeDecision(context);

    assertExists(result);
    assertInstanceOf(result.action, String);
    assertInstanceOf(result.comfortScore, Number);
    assertInstanceOf(result.energyScore, Number);
    assertInstanceOf(result.costScore, Number);
    assertInstanceOf(result.overallScore, Number);
    assertExists(result.reasoning);
    assertEquals(Array.isArray(result.factors), true);

    // Should prioritize comfort with high comfort weight
    assertEquals(result.comfortScore >= 0.7, true);
  });

  await t.step('should optimize for energy efficiency', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.2,
      energyWeight: 0.7, // High energy priority
      costWeight: 0.1,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    const context: HVACDecisionContext = {
      indoorTemp: 21.0,
      outdoorTemp: 25.0,
      targetTemp: 20.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'cooling',
      currentHour: 14,
      isWeekday: true,
    };

    const result = await optimizer.optimizeDecision(context);

    assertExists(result);
    // Should prioritize energy efficiency
    assertEquals(result.energyScore >= 0.6, true);
  });

  await t.step('should generate schedule recommendations', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    const context: HVACDecisionContext = {
      indoorTemp: 20.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    const schedule = await optimizer.optimizeSchedule(context, 8); // 8 hour schedule

    assertExists(schedule);
    assertExists(schedule.recommendedSchedule);
    assertEquals(Array.isArray(schedule.recommendedSchedule), true);
    assertEquals(schedule.recommendedSchedule.length > 0, true);

    // Check schedule item structure
    if (schedule.recommendedSchedule.length > 0) {
      const item = schedule.recommendedSchedule[0];
      assertExists(item.startTime);
      assertExists(item.endTime);
      assertInstanceOf(item.targetTemp, Number);
      assertExists(item.priority);
      assertInstanceOf(item.energyBudget, Number);
    }
  });

  await t.step('should get configuration info', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);
    const configInfo = optimizer.getConfig();

    assertExists(configInfo);
    assertEquals(configInfo.comfortWeight, 0.4);
    assertEquals(configInfo.energyWeight, 0.4);
    assertEquals(configInfo.costWeight, 0.2);
  });

  await t.step('should update configuration', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    // Update configuration
    optimizer.updateConfig({
      comfortWeight: 0.6,
      energyWeight: 0.3,
      costWeight: 0.1,
    });

    const updatedConfig = optimizer.getConfig();
    assertEquals(updatedConfig.comfortWeight, 0.6);
    assertEquals(updatedConfig.energyWeight, 0.3);
    assertEquals(updatedConfig.costWeight, 0.1);
  });

  await t.step('should handle boundary conditions', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      energyRates: {
        peak: 0.15,
        offPeak: 0.08,
        peakHours: [16, 17, 18, 19, 20]
      },
      comfortRange: {
        min: 18,
        max: 26,
        preferred: 22,
        tolerance: 1.5
      },
      systemConstraints: {
        minRunTime: 15,
        maxCyclesPerHour: 4,
        defrostInterval: 4
      },
      optimizationHorizon: 24,
      updateInterval: 15,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    // Test extreme temperature difference
    const extremeContext: HVACDecisionContext = {
      indoorTemp: 10.0, // Very cold
      outdoorTemp: -10.0, // Extremely cold outside
      targetTemp: 25.0, // Want it very warm
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    const result = await optimizer.optimizeDecision(extremeContext);

    assertExists(result);
    // Should handle extreme conditions gracefully
    assertInstanceOf(result.overallScore, Number);
    assertEquals(result.overallScore >= 0 && result.overallScore <= 1, true);
  });

});
