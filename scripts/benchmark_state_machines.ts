#!/usr/bin/env -S deno run --allow-all
/**
 * Performance Benchmark: XState vs LangGraph Implementation
 * 
 * This script benchmarks the performance differences between XState and LangGraph
 * state machine implementations for HVAC control.
 */

import { createContainer } from '../src/core/container.ts';
import { XStateHVACStateMachineAdapter } from '../src/hvac/state-machine-xstate-adapter.ts';
import { LangGraphHVACStateMachineAdapter } from '../src/hvac/state-machine-lg-adapter.ts';
import { HVACMode, SystemMode } from '../src/types/common.ts';

interface BenchmarkResult {
  implementation: string;
  operation: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  memoryUsageMB?: number;
}

/**
 * Benchmark a specific operation
 */
async function benchmarkOperation(
  name: string,
  operation: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];
  
  // Warm up
  for (let i = 0; i < 5; i++) {
    await operation();
  }
  
  // Force garbage collection if available
  if ((globalThis as any).gc) {
    (globalThis as any).gc();
  }
  
  const memoryBefore = (Deno as any).memoryUsage?.() || { rss: 0 };
  const startTime = performance.now();
  
  // Benchmark iterations
  for (let i = 0; i < iterations; i++) {
    const iterationStart = performance.now();
    await operation();
    const iterationTime = performance.now() - iterationStart;
    times.push(iterationTime);
  }
  
  const totalTime = performance.now() - startTime;
  const memoryAfter = (Deno as any).memoryUsage?.() || { rss: 0 };
  
  return {
    implementation: name,
    operation: operation.name || 'anonymous',
    iterations,
    totalTimeMs: totalTime,
    avgTimeMs: totalTime / iterations,
    minTimeMs: Math.min(...times),
    maxTimeMs: Math.max(...times),
    memoryUsageMB: (memoryAfter.rss - memoryBefore.rss) / 1024 / 1024
  };
}

/**
 * Benchmark XState implementation
 */
async function benchmarkXState() {
  console.log('🔄 Benchmarking XState Implementation...');
  
  // Create container with default (XState) config
  const container = await createContainer('./config/hvac_config.yaml');
  const stateMachine = container.get(Symbol.for('HVACStateMachine')) as XStateHVACStateMachineAdapter;
  
  const results: BenchmarkResult[] = [];
  
  // Start state machine
  await stateMachine.start();
  
  // Benchmark 1: State machine initialization
  results.push(await benchmarkOperation('XState', async () => {
    // Create a new instance
    const { XStateHVACStateMachineAdapter } = await import('../src/hvac/state-machine-xstate-adapter.ts');
    const { LoggerService } = await import('../src/core/logger.ts');
    const hvacOptions = container.getSettings().hvacOptions;
    const logger = new LoggerService('benchmark');
    const temp = new XStateHVACStateMachineAdapter(hvacOptions, logger);
    await temp.start();
    await temp.stop();
  }, 50));
  
  // Benchmark 2: Temperature updates
  results.push(await benchmarkOperation('XState', async () => {
    await stateMachine.handleTemperatureChange('sensor.indoor', 20.5 + Math.random());
  }, 500));
  
  // Benchmark 3: Manual overrides
  results.push(await benchmarkOperation('XState', async () => {
    await stateMachine.manualOverride(HVACMode.HEAT, 22.0);
    if (stateMachine.clearManualOverride) {
      await stateMachine.clearManualOverride();
    }
  }, 100));
  
  // Benchmark 4: System mode changes
  results.push(await benchmarkOperation('XState', async () => {
    if (stateMachine.updateSystemMode) {
      await stateMachine.updateSystemMode(SystemMode.AUTO);
    }
  }, 100));
  
  // Benchmark 5: Status retrieval
  results.push(await benchmarkOperation('XState', async () => {
    const status = stateMachine.getStatus();
    const context = stateMachine.getContext();
  }, 1000));
  
  await stateMachine.stop();
  await container.dispose();
  
  return results;
}

/**
 * Benchmark LangGraph implementation
 */
async function benchmarkLangGraph() {
  console.log('🧪 Benchmarking LangGraph Implementation...');
  
  // Create container with LangGraph config
  const container = await createContainer('./config/hvac_config_langgraph_experiment.yaml');
  const stateMachine = container.get(Symbol.for('HVACStateMachine')) as LangGraphHVACStateMachineAdapter;
  
  const results: BenchmarkResult[] = [];
  
  // Start state machine
  await stateMachine.start();
  
  // Benchmark 1: State machine initialization
  results.push(await benchmarkOperation('LangGraph', async () => {
    // Create a new instance
    const { LangGraphHVACStateMachineAdapter } = await import('../src/hvac/state-machine-lg-adapter.ts');
    const { LoggerService } = await import('../src/core/logger.ts');
    const hvacOptions = container.getSettings().hvacOptions;
    const appOptions = container.getSettings().appOptions;
    const logger = new LoggerService('benchmark');
    const temp = new LangGraphHVACStateMachineAdapter(hvacOptions, appOptions, logger);
    await temp.start();
    await temp.stop();
  }, 50));
  
  // Benchmark 2: Temperature updates
  results.push(await benchmarkOperation('LangGraph', async () => {
    await stateMachine.handleTemperatureChange('sensor.indoor', 20.5 + Math.random());
  }, 100)); // Reduced iterations due to potential infinite loop
  
  // Benchmark 3: Manual overrides
  results.push(await benchmarkOperation('LangGraph', async () => {
    await stateMachine.manualOverride(HVACMode.HEAT, 22.0);
    if (stateMachine.clearManualOverride) {
      await stateMachine.clearManualOverride();
    }
  }, 50)); // Reduced iterations
  
  // Benchmark 4: System mode changes
  results.push(await benchmarkOperation('LangGraph', async () => {
    if (stateMachine.updateSystemMode) {
      await stateMachine.updateSystemMode(SystemMode.AUTO);
    }
  }, 50)); // Reduced iterations
  
  // Benchmark 5: Status retrieval
  results.push(await benchmarkOperation('LangGraph', async () => {
    const status = stateMachine.getStatus();
    const context = stateMachine.getContext();
  }, 1000));
  
  await stateMachine.stop();
  await container.dispose();
  
  return results;
}

/**
 * Display benchmark results
 */
function displayResults(xstateResults: BenchmarkResult[], langgraphResults: BenchmarkResult[]) {
  console.log('\n📊 Performance Benchmark Results\n');
  
  const operations = ['initialization', 'temperature_updates', 'manual_overrides', 'system_mode_changes', 'status_retrieval'];
  
  console.log('┌─────────────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐');
  console.log('│ Operation           │ XState (ms) │ LangGraph   │ Difference  │ Memory (MB) │ Performance │');
  console.log('├─────────────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤');
  
  for (let i = 0; i < Math.min(operations.length, xstateResults.length, langgraphResults.length); i++) {
    const xstate = xstateResults[i];
    const langgraph = langgraphResults[i];
    
    const xstateAvg = xstate.avgTimeMs.toFixed(3);
    const langgraphAvg = langgraph.avgTimeMs.toFixed(3);
    const difference = ((langgraph.avgTimeMs - xstate.avgTimeMs) / xstate.avgTimeMs * 100).toFixed(1);
    const memoryDiff = ((langgraph.memoryUsageMB || 0) - (xstate.memoryUsageMB || 0)).toFixed(1);
    
    const performance = parseFloat(difference) < 0 ? '🟢 LangGraph' : 
                       parseFloat(difference) < 50 ? '🟡 Similar' : '🔴 XState';
    
    const operationName = operations[i].replace('_', ' ');
    
    console.log(`│ ${operationName.padEnd(19)} │ ${xstateAvg.padStart(11)} │ ${langgraphAvg.padStart(11)} │ ${(difference + '%').padStart(11)} │ ${memoryDiff.padStart(11)} │ ${performance.padEnd(11)} │`);
  }
  
  console.log('└─────────────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘');
  
  // Summary statistics
  console.log('\n📈 Summary Statistics:');
  
  const xstateTotal = xstateResults.reduce((sum, r) => sum + r.avgTimeMs, 0);
  const langgraphTotal = langgraphResults.reduce((sum, r) => sum + r.avgTimeMs, 0);
  
  console.log(`Total average execution time:`);
  console.log(`  XState:    ${xstateTotal.toFixed(3)} ms`);
  console.log(`  LangGraph: ${langgraphTotal.toFixed(3)} ms`);
  console.log(`  Difference: ${((langgraphTotal - xstateTotal) / xstateTotal * 100).toFixed(1)}%`);
  
  // Detailed results
  console.log('\n📋 Detailed Results:');
  console.log('\nXState Results:');
  xstateResults.forEach((result, i) => {
    console.log(`  ${operations[i]}: avg=${result.avgTimeMs.toFixed(3)}ms, min=${result.minTimeMs.toFixed(3)}ms, max=${result.maxTimeMs.toFixed(3)}ms`);
  });
  
  console.log('\nLangGraph Results:');
  langgraphResults.forEach((result, i) => {
    console.log(`  ${operations[i]}: avg=${result.avgTimeMs.toFixed(3)}ms, min=${result.minTimeMs.toFixed(3)}ms, max=${result.maxTimeMs.toFixed(3)}ms`);
  });
}

/**
 * Main benchmark execution
 */
async function runBenchmarks() {
  console.log('⚡ HVAC State Machine Performance Benchmark\n');
  console.log('This benchmark compares XState vs LangGraph implementations');
  console.log('for key HVAC state machine operations.\n');
  
  try {
    // Run XState benchmarks
    const xstateResults = await benchmarkXState();
    
    // Small delay between benchmarks
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Run LangGraph benchmarks
    const langgraphResults = await benchmarkLangGraph();
    
    // Display results
    displayResults(xstateResults, langgraphResults);
    
    console.log('\n🎯 Benchmark completed successfully!');
    console.log('\n📝 Analysis Notes:');
    console.log('- LangGraph may show higher initial overhead due to graph compilation');
    console.log('- XState benefits from optimized state machine execution');
    console.log('- Memory usage differences may indicate overhead of enhanced features');
    console.log('- Performance should be evaluated in context of feature richness');
    
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    console.error('\n🔍 Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error)
    });
    
    Deno.exit(1);
  }
}

// Main execution
if (import.meta.main) {
  await runBenchmarks();
}