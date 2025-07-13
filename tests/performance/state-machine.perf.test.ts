/**
 * Performance Benchmark: HVAC State Machine
 *
 * This script benchmarks the performance of the XState HVAC implementation
 * to ensure optimal performance under various load conditions.
 */

import { test, expect } from "bun:test";
import { createContainer } from "../../src/core/container.ts";
import { HVACStateMachine } from "../../src/hvac/state-machine.ts";
import { HVACMode } from "../../src/types/common.ts";

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

  const memoryBefore = process.memoryUsage?.() || { rss: 0 };
  const startTime = performance.now();

  // Benchmark iterations
  for (let i = 0; i < iterations; i++) {
    const iterationStart = performance.now();
    await operation();
    const iterationTime = performance.now() - iterationStart;
    times.push(iterationTime);
  }

  const totalTime = performance.now() - startTime;
  const memoryAfter = process.memoryUsage?.() || { rss: 0 };

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
  console.log("🔄 Benchmarking XState HVAC State Machine...\n");

  // Create container with test config
  const container = await createContainer("config/hvac_config_unit_test.yaml");
  const stateMachine = container.get(
    Symbol.for("HVACStateMachine"),
  ) as HVACStateMachine;

  const results: BenchmarkResult[] = [];

  // Test 1: Start/Stop Performance
  results.push(
    await benchmarkOperation(
      "Start/Stop Cycle",
      () => {
        stateMachine.start();
        stateMachine.stop();
      },
      10, // Reduced iterations
    ),
  );

  // Restart for remaining tests
  stateMachine.start();

  // Test 2: Temperature Updates
  results.push(
    await benchmarkOperation(
      "Temperature Update",
      () => {
        stateMachine.send({
          type: "UPDATE_TEMPERATURES",
          indoor: 20 + Math.random() * 10,
          outdoor: 15 + Math.random() * 20,
        });
      },
      100, // Reduced iterations
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
      "Manual Override",
      () => {
        const mode = modes[Math.floor(Math.random() * modes.length)];
        stateMachine.manualOverride(mode);
      },
      5, // Minimal iterations for CI
    ),
  );

  // Test 4: Status Queries
  results.push(
    await benchmarkOperation(
      "Status Query",
      () => {
        stateMachine.getStatus();
      },
      200, // Reduced iterations
    ),
  );

  // Test 5: State Evaluation
  results.push(
    await benchmarkOperation(
      "State Evaluation",
      () => {
        stateMachine.evaluateConditions();
      },
      5, // Minimal iterations for CI
    ),
  );

  stateMachine.stop();

  // Display results
  console.log("📊 Performance Results:\n");
  console.log(
    "| Operation | Iterations | Avg Time (ms) | Min/Max (ms) | Memory (MB) |",
  );
  console.log(
    "|-----------|------------|---------------|---------------|-------------|",
  );

  for (const result of results) {
    const avgTime = result.avgTimeMs.toFixed(2);
    const minTime = result.minTimeMs.toFixed(2);
    const maxTime = result.maxTimeMs.toFixed(2);
    const memory = result.memoryUsageMB?.toFixed(2) || "N/A";

    console.log(
      `| ${result.operation.padEnd(9)} | ${result.iterations
        .toString()
        .padEnd(
          10,
        )} | ${avgTime.padEnd(13)} | ${minTime}/${maxTime.padEnd(8)} | ${memory.padEnd(
        11,
      )} |`,
    );
  }

  // Performance assertions
  const tempUpdateResult = results.find(
    (r) => r.operation === "Temperature Update",
  );
  const statusQueryResult = results.find((r) => r.operation === "Status Query");

  if (tempUpdateResult) {
    // Temperature updates should be very fast (< 1ms average)
    expect(tempUpdateResult.avgTimeMs).toBeLessThan(1.0);
  }

  if (statusQueryResult) {
    // Status queries should be extremely fast (< 0.1ms average)
    expect(statusQueryResult.avgTimeMs).toBeLessThan(0.1);
  }

  console.log("\n✅ All performance benchmarks completed successfully!");
}

/**
 * Stress test for concurrent operations
 */
async function testConcurrentOperations(): Promise<void> {
  console.log("\n🚀 Testing Concurrent Operations...\n");

  const container = await createContainer("config/hvac_config_unit_test.yaml");
  const stateMachine = container.get(
    Symbol.for("HVACStateMachine"),
  ) as HVACStateMachine;

  stateMachine.start();

  const startTime = performance.now();
  const concurrentOps = 10; // Reduced for faster testing

  // Run multiple operations concurrently
  const promises = [];
  for (let i = 0; i < concurrentOps; i++) {
    promises.push(
      Promise.all([
        Promise.resolve(
          stateMachine.send({
            type: "UPDATE_TEMPERATURES",
            indoor: 20 + Math.random() * 5,
            outdoor: 15 + Math.random() * 10,
          }),
        ),
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

  stateMachine.stop();

  // Assert reasonable performance under concurrency
  const avgPerOp = totalTime / (concurrentOps * 3);
  expect(avgPerOp).toBeLessThan(5.0);

  console.log("✅ Concurrent operations test completed successfully!");
}

// Bun test declarations
test("HVAC State Machine Performance - XState Performance", async () => {
  await testXStatePerformance();
}, 30000); // 30 second timeout

test("HVAC State Machine Performance - Concurrent Operations", async () => {
  await testConcurrentOperations();
}, 15000); // 15 second timeout
