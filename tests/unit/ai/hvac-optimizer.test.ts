/**
 * Unit tests for HVAC Optimizer
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  HVACOptimizer,
  OptimizationConfig,
} from '../../../src/ai/optimization/hvac-optimizer.ts';
import {
  HVACDecisionContext,
  OptimizationResult,
} from '../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../src/types/common.ts';
import { LoggerService } from '../../../src/core/logger.ts';

// Mock logger
class MockLoggerService implements LoggerService {
  info(_message: string, _data?: Record<string, unknown>): void {}
  error(
    _message: string,
    _error?: unknown,
    _data?: Record<string, unknown>,
  ): void {}
  debug(_message: string, _data?: Record<string, unknown>): void {}
  warning(_message: string, _data?: Record<string, unknown>): void {}
}

Deno.test('HVAC Optimizer', async (t) => {
  const mockLogger = new MockLoggerService();

  await t.step('should initialize with configuration', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.5,
      energyWeight: 0.3,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);
    assertExists(optimizer);
  });

  await t.step('should optimize for comfort priority', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.8, // High comfort priority
      energyWeight: 0.1,
      costWeight: 0.1,
      targetComfortScore: 0.9,
      maxEnergyUsage: 200,
      maxCostPerHour: 10.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
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

    const result = await optimizer.optimize(context);

    assertExists(result);
    assertInstanceOf(result.recommendedAction, String);
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
      targetComfortScore: 0.6,
      maxEnergyUsage: 50, // Low energy limit
      maxCostPerHour: 10.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
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

    const result = await optimizer.optimize(context);

    assertExists(result);
    // Should prioritize energy efficiency
    assertEquals(result.energyScore >= 0.6, true);
  });

  await t.step('should generate schedule recommendations', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    const schedule = await optimizer.generateOptimalSchedule(8); // 8 hour schedule

    assertExists(schedule);
    assertEquals(Array.isArray(schedule), true);
    assertEquals(schedule.length > 0, true);

    // Check schedule item structure
    if (schedule.length > 0) {
      const item = schedule[0];
      assertExists(item.time);
      assertExists(item.action);
      assertInstanceOf(item.targetTemp, Number);
      assertInstanceOf(item.comfortPriority, Number);
      assertInstanceOf(item.energyPriority, Number);
      assertExists(item.reasoning);
    }
  });

  await t.step('should calculate energy efficiency', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    const efficiency = optimizer.calculateEnergyEfficiency(
      22.0, // target temp
      21.0, // current temp
      15.0, // outdoor temp
      'heating',
    );

    assertExists(efficiency);
    assertInstanceOf(efficiency.efficiency, Number);
    assertInstanceOf(efficiency.estimatedEnergyUsage, Number);
    assertInstanceOf(efficiency.estimatedCost, Number);
    assertExists(efficiency.factors);
    assertEquals(Array.isArray(efficiency.factors), true);

    // Efficiency should be between 0 and 1
    assertEquals(
      efficiency.efficiency >= 0 && efficiency.efficiency <= 1,
      true,
    );
  });

  await t.step('should track optimization history', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);

    // Perform multiple optimizations
    const context: HVACDecisionContext = {
      indoorTemp: 20.0,
      outdoorTemp: 15.0,
      targetTemp: 22.0,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      currentHour: 14,
      isWeekday: true,
    };

    await optimizer.optimize(context);
    await optimizer.optimize({ ...context, indoorTemp: 21.0 });

    const history = optimizer.getOptimizationHistory();

    assertExists(history);
    assertEquals(Array.isArray(history), true);
    assertEquals(history.length >= 2, true);

    // Check history item structure
    if (history.length > 0) {
      const item = history[0];
      assertExists(item.timestamp);
      assertExists(item.context);
      assertExists(item.result);
      assertInstanceOf(item.result.overallScore, Number);
    }
  });

  await t.step('should handle boundary conditions', async () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.4,
      energyWeight: 0.4,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
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

    const result = await optimizer.optimize(extremeContext);

    assertExists(result);
    // Should handle extreme conditions gracefully
    assertInstanceOf(result.overallScore, Number);
    assertEquals(result.overallScore >= 0 && result.overallScore <= 1, true);
  });

  await t.step('should provide configuration info', () => {
    const config: OptimizationConfig = {
      comfortWeight: 0.5,
      energyWeight: 0.3,
      costWeight: 0.2,
      targetComfortScore: 0.8,
      maxEnergyUsage: 100,
      maxCostPerHour: 5.0,
      optimizationInterval: 15,
      historyWindow: 24,
      learningRate: 0.1,
      adaptationEnabled: true,
    };

    const optimizer = new HVACOptimizer(config, mockLogger);
    const configInfo = optimizer.getConfiguration();

    assertExists(configInfo);
    assertEquals(configInfo.comfortWeight, 0.5);
    assertEquals(configInfo.energyWeight, 0.3);
    assertEquals(configInfo.costWeight, 0.2);
  });
});
