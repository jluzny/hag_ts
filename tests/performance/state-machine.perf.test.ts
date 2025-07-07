#!/usr/bin/env -S deno run --allow-all
/**
 * Performance Benchmark: HVAC State Machine
 *
 * This script benchmarks the performance of the XState HVAC implementation
 * to ensure optimal performance under various load conditions.
 */

import { assertEquals } from '@std/assert';
import { createContainer } from '../../src/core/container.ts';
import { HVACStateMachine } from '../../src/hvac/state-machine.ts';
import { HVACMode } from '../../src/types/common.ts';

interface BenchmarkResult {
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
  operation: () => Promise<void> | void,
  iterations: number = 100,
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warm up
  for (let i = 0; i < 5; i++) {
    await operation();
  }

  // Force garbage collection if available
  if ((globalThis as { gc?: () => void }).gc) {
    (globalThis as { gc?: () => void }).gc!();
  }

  const memoryBefore =
    (Deno as { memoryUsage?: () => { rss: number } }).memoryUsage?.() ||
    { rss: 0 };
  const startTime = performance.now();

  // Benchmark iterations
  for (let i = 0; i < iterations; i++) {
    const iterationStart = performance.now();
    await operation();
    const iterationTime = performance.now() - iterationStart;
    times.push(iterationTime);
  }

  const totalTime = performance.now() - startTime;
  const memoryAfter =
    (Deno as { memoryUsage?: () => { rss: number } }).memoryUsage?.() ||
    { rss: 0 };

  return {
    operation: name,
    iterations,
    totalTimeMs: totalTime,
    avgTimeMs: totalTime / iterations,
    minTimeMs: Math.min(...times),
    maxTimeMs: Math.max(...times),
    memoryUsageMB: (memoryAfter.rss - memoryBefore.rss) / 1024 / 1024,
  };
}

/**
 * Performance test for XState HVAC State Machine
 */
async function testXStatePerformance(): Promise<void> {
  console.log('🔄 Benchmarking XState HVAC State Machine...\n');

  // Create container with test config
  const container = await createContainer('config/hvac_config_unit_test.yaml');
  const stateMachine = container.get(
    Symbol.for('HVACStateMachine'),
  ) as HVACStateMachine;

  const results: BenchmarkResult[] = [];

  // Test 1: Start/Stop Performance
  results.push(
    await benchmarkOperation(
      'Start/Stop Cycle',
      async () => {
        await stateMachine.start();
        await stateMachine.stop();
      },
      50,
    ),
  );

  // Restart for remaining tests
  await stateMachine.start();

  // Test 2: Temperature Updates
  results.push(
    await benchmarkOperation(
      'Temperature Update',
      async () => {
        stateMachine.send({
          type: 'UPDATE_TEMPERATURES',
          indoor: 20 + Math.random() * 10,
          outdoor: 15 + Math.random() * 20,
        });
      },
      1000,
    ),
  );

  // Test 3: Manual Override
  const modes = [
    HVACMode.HEAT,
    HVACMode.COOL,
    HVACMode.OFF,
    HVACMode.AUTO,
  ] as const;
  results.push(
    await benchmarkOperation(
      'Manual Override',
      async () => {
        const mode = modes[Math.floor(Math.random() * modes.length)];
        await stateMachine.manualOverride(mode);
      },
      500,
    ),
  );

  // Test 4: Status Queries
  results.push(
    await benchmarkOperation(
      'Status Query',
      () => {
        stateMachine.getStatus();
      },
      2000,
    ),
  );

  // Test 5: State Evaluation
  results.push(
    await benchmarkOperation(
      'State Evaluation',
      () => {
        stateMachine.evaluateConditions();
      },
      200,
    ),
  );

  await stateMachine.stop();

  // Display results
  console.log('📊 Performance Results:\n');
  console.log(
    '| Operation | Iterations | Avg Time (ms) | Min/Max (ms) | Memory (MB) |',
  );
  console.log(
    '|-----------|------------|---------------|---------------|-------------|',
  );

  for (const result of results) {
    const avgTime = result.avgTimeMs.toFixed(2);
    const minTime = result.minTimeMs.toFixed(2);
    const maxTime = result.maxTimeMs.toFixed(2);
    const memory = result.memoryUsageMB?.toFixed(2) || 'N/A';

    console.log(
      `| ${result.operation.padEnd(9)} | ${
        result.iterations.toString().padEnd(10)
      } | ${avgTime.padEnd(13)} | ${minTime}/${maxTime.padEnd(8)} | ${
        memory.padEnd(11)
      } |`,
    );
  }

  // Performance assertions
  const tempUpdateResult = results.find((r) =>
    r.operation === 'Temperature Update'
  );
  const statusQueryResult = results.find((r) => r.operation === 'Status Query');

  if (tempUpdateResult) {
    // Temperature updates should be very fast (< 1ms average)
    assertEquals(
      tempUpdateResult.avgTimeMs < 1.0,
      true,
      'Temperature updates should be < 1ms on average',
    );
  }

  if (statusQueryResult) {
    // Status queries should be extremely fast (< 0.1ms average)
    assertEquals(
      statusQueryResult.avgTimeMs < 0.1,
      true,
      'Status queries should be < 0.1ms on average',
    );
  }

  console.log('\n✅ All performance benchmarks completed successfully!');
}

/**
 * Stress test for concurrent operations
 */
async function testConcurrentOperations(): Promise<void> {
  console.log('\n🚀 Testing Concurrent Operations...\n');

  const container = await createContainer('config/hvac_config_unit_test.yaml');
  const stateMachine = container.get(
    Symbol.for('HVACStateMachine'),
  ) as HVACStateMachine;

  await stateMachine.start();

  const startTime = performance.now();
  const concurrentOps = 50;

  // Run multiple operations concurrently
  const promises = [];
  for (let i = 0; i < concurrentOps; i++) {
    promises.push(
      Promise.all([
        Promise.resolve(stateMachine.send({
          type: 'UPDATE_TEMPERATURES',
          indoor: 20 + Math.random() * 5,
          outdoor: 15 + Math.random() * 10,
        })),
        stateMachine.getStatus(),
        Promise.resolve(stateMachine.evaluateConditions()),
      ]),
    );
  }

  await Promise.all(promises);

  const totalTime = performance.now() - startTime;

  console.log(`📊 Concurrent Operations Results:`);
  console.log(
    `   Operations: ${concurrentOps * 3} (${concurrentOps} batches of 3)`,
  );
  console.log(`   Total Time: ${totalTime.toFixed(2)}ms`);
  console.log(`   Avg per batch: ${(totalTime / concurrentOps).toFixed(2)}ms`);
  console.log(
    `   Avg per operation: ${(totalTime / (concurrentOps * 3)).toFixed(2)}ms`,
  );

  await stateMachine.stop();

  // Assert reasonable performance under concurrency
  const avgPerOp = totalTime / (concurrentOps * 3);
  assertEquals(
    avgPerOp < 5.0,
    true,
    'Concurrent operations should average < 5ms each',
  );

  console.log('✅ Concurrent operations test completed successfully!');
}

// Deno test declarations
Deno.test('HVAC State Machine Performance - XState Performance', async () => {
  await testXStatePerformance();
});

Deno.test('HVAC State Machine Performance - Concurrent Operations', async () => {
  await testConcurrentOperations();
});

// Run performance tests if called directly
if (import.meta.main) {
  console.log('⚡ HVAC State Machine Performance Tests\n');

  try {
    await testXStatePerformance();
    await testConcurrentOperations();

    console.log('\n🎉 All performance tests passed!');
  } catch (error) {
    console.error(
      '❌ Performance test failed:',
      error instanceof Error ? error.message : String(error),
    );
    Deno.exit(1);
  }
}
