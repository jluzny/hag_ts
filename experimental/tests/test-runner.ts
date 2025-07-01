#!/usr/bin/env -S deno run --allow-all

/**
 * Comprehensive Test Runner for HAG Experimental AI Features
 * 
 * This script runs all test suites for the experimental AI system,
 * including unit tests, integration tests, and performance benchmarks.
 */

import { parseArgs } from '@std/cli/parse-args';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

interface TestSuite {
  name: string;
  path: string;
  type: 'unit' | 'integration' | 'performance';
  description: string;
  estimatedDuration: string;
}

const testSuites: TestSuite[] = [
  // Unit Tests
  {
    name: 'Adaptive Learning Engine',
    path: './unit/ai/learning/adaptive-learning-engine.test.ts',
    type: 'unit',
    description: 'Tests user interaction recording, pattern detection, and personalized recommendations',
    estimatedDuration: '~2 min'
  },
  {
    name: 'HVAC Optimizer',
    path: './unit/ai/optimization/hvac-optimizer.test.ts',
    type: 'unit',
    description: 'Tests energy efficiency optimization, comfort scoring, and cost analysis',
    estimatedDuration: '~3 min'
  },
  {
    name: 'Predictive Analytics Engine',
    path: './unit/ai/predictive/analytics-engine.test.ts',
    type: 'unit',
    description: 'Tests temperature prediction, pattern analysis, and weather integration',
    estimatedDuration: '~2 min'
  },
  {
    name: 'Smart Scheduler',
    path: './unit/ai/scheduling/smart-scheduler.test.ts',
    type: 'unit',
    description: 'Tests intelligent scheduling, optimization strategies, and learning integration',
    estimatedDuration: '~3 min'
  },
  {
    name: 'System Monitor',
    path: './unit/ai/monitoring/system-monitor.test.ts',
    type: 'unit',
    description: 'Tests health monitoring, performance tracking, and alert management',
    estimatedDuration: '~2 min'
  },
  {
    name: 'Performance Optimizer',
    path: './unit/ai/optimization/performance-optimizer.test.ts',
    type: 'unit',
    description: 'Tests performance analysis, bottleneck detection, and optimization strategies',
    estimatedDuration: '~2 min'
  },
  {
    name: 'Performance Dashboard',
    path: './unit/ai/dashboard/performance-dashboard.test.ts',
    type: 'unit',
    description: 'Tests dashboard data aggregation, real-time updates, and visualization',
    estimatedDuration: '~2 min'
  },
  // Integration Tests
  {
    name: 'AI System Integration',
    path: './integration/ai-system-integration.test.ts',
    type: 'integration',
    description: 'Tests end-to-end workflows, component interactions, and real-world scenarios',
    estimatedDuration: '~5 min'
  },
  // Performance Tests
  {
    name: 'AI System Performance',
    path: './performance/ai-system-performance.test.ts',
    type: 'performance',
    description: 'Benchmarks performance, scalability, memory usage, and stress testing',
    estimatedDuration: '~4 min'
  }
];

async function runTest(suite: TestSuite): Promise<{ success: boolean; duration: number; output: string }> {
  const startTime = performance.now();
  
  try {
    console.log(`${colors.cyan}▶ Running ${suite.name}...${colors.reset}`);
    
    const command = new Deno.Command('deno', {
      args: ['test', '--allow-all', '--unstable', suite.path],
      stdout: 'piped',
      stderr: 'piped',
    });

    const process = await command.output();
    const duration = performance.now() - startTime;
    const output = new TextDecoder().decode(process.stdout) + new TextDecoder().decode(process.stderr);
    
    return {
      success: process.code === 0,
      duration,
      output
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      success: false,
      duration,
      output: `Error running test: ${error.message}`
    };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function printBanner() {
  console.log(`${colors.bright}${colors.blue}`);
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                    HAG Experimental AI Test Suite                    ║');
  console.log('║                                                                       ║');
  console.log('║  Comprehensive testing for intelligent HVAC automation system        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);
}

function printTestSummary(suites: TestSuite[]) {
  console.log(`${colors.bright}📋 Test Suite Overview:${colors.reset}`);
  console.log('═'.repeat(80));
  
  const unitTests = suites.filter(s => s.type === 'unit');
  const integrationTests = suites.filter(s => s.type === 'integration');
  const performanceTests = suites.filter(s => s.type === 'performance');
  
  console.log(`${colors.green}Unit Tests (${unitTests.length}):${colors.reset}`);
  unitTests.forEach(suite => {
    console.log(`  • ${suite.name} ${colors.yellow}${suite.estimatedDuration}${colors.reset}`);
    console.log(`    ${suite.description}`);
  });
  
  console.log(`\n${colors.blue}Integration Tests (${integrationTests.length}):${colors.reset}`);
  integrationTests.forEach(suite => {
    console.log(`  • ${suite.name} ${colors.yellow}${suite.estimatedDuration}${colors.reset}`);
    console.log(`    ${suite.description}`);
  });
  
  console.log(`\n${colors.magenta}Performance Tests (${performanceTests.length}):${colors.reset}`);
  performanceTests.forEach(suite => {
    console.log(`  • ${suite.name} ${colors.yellow}${suite.estimatedDuration}${colors.reset}`);
    console.log(`    ${suite.description}`);
  });
  
  console.log('\n═'.repeat(80));
  console.log(`${colors.bright}Total: ${suites.length} test suites${colors.reset}\n`);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ['help', 'unit', 'integration', 'performance', 'verbose', 'fast'],
    string: ['suite'],
    alias: {
      h: 'help',
      u: 'unit',
      i: 'integration',
      p: 'performance',
      s: 'suite',
      v: 'verbose',
      f: 'fast'
    }
  });

  if (args.help) {
    console.log(`${colors.bright}HAG Experimental AI Test Runner${colors.reset}

Usage: deno run --allow-all test-runner.ts [options]

Options:
  -h, --help           Show this help message
  -u, --unit           Run only unit tests
  -i, --integration    Run only integration tests  
  -p, --performance    Run only performance tests
  -s, --suite <name>   Run specific test suite
  -v, --verbose        Show detailed output for each test
  -f, --fast           Skip performance tests for faster execution

Examples:
  deno run --allow-all test-runner.ts                    # Run all tests
  deno run --allow-all test-runner.ts --unit             # Run only unit tests
  deno run --allow-all test-runner.ts --suite "HVAC"     # Run HVAC-related tests
  deno run --allow-all test-runner.ts --fast             # Run without performance tests
`);
    return;
  }

  printBanner();

  // Filter test suites based on arguments
  let suitesToRun = testSuites;

  if (args.unit) {
    suitesToRun = suitesToRun.filter(s => s.type === 'unit');
  } else if (args.integration) {
    suitesToRun = suitesToRun.filter(s => s.type === 'integration');
  } else if (args.performance) {
    suitesToRun = suitesToRun.filter(s => s.type === 'performance');
  } else if (args.fast) {
    suitesToRun = suitesToRun.filter(s => s.type !== 'performance');
  }

  if (args.suite) {
    suitesToRun = suitesToRun.filter(s => 
      s.name.toLowerCase().includes(args.suite.toLowerCase())
    );
  }

  if (suitesToRun.length === 0) {
    console.log(`${colors.red}No test suites match your criteria.${colors.reset}`);
    return;
  }

  printTestSummary(suitesToRun);

  const startTime = performance.now();
  const results = [];
  let totalTests = 0;
  let passedTests = 0;

  for (const suite of suitesToRun) {
    const result = await runTest(suite);
    results.push({ suite, ...result });

    if (result.success) {
      console.log(`${colors.green}✅ ${suite.name} passed${colors.reset} ${colors.yellow}(${formatDuration(result.duration)})${colors.reset}`);
      passedTests++;
    } else {
      console.log(`${colors.red}❌ ${suite.name} failed${colors.reset} ${colors.yellow}(${formatDuration(result.duration)})${colors.reset}`);
    }

    if (args.verbose || !result.success) {
      console.log(`${colors.cyan}Output:${colors.reset}`);
      console.log(result.output);
      console.log('─'.repeat(80));
    }

    totalTests++;
  }

  const totalDuration = performance.now() - startTime;

  // Print final summary
  console.log('\n' + '═'.repeat(80));
  console.log(`${colors.bright}📊 Test Results Summary${colors.reset}`);
  console.log('═'.repeat(80));

  console.log(`${colors.bright}Overall Results:${colors.reset}`);
  console.log(`  Total Suites: ${totalTests}`);
  console.log(`  Passed: ${colors.green}${passedTests}${colors.reset}`);
  console.log(`  Failed: ${colors.red}${totalTests - passedTests}${colors.reset}`);
  console.log(`  Success Rate: ${colors.bright}${((passedTests / totalTests) * 100).toFixed(1)}%${colors.reset}`);
  console.log(`  Total Duration: ${colors.yellow}${formatDuration(totalDuration)}${colors.reset}`);

  // Show failed tests details
  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log(`\n${colors.red}Failed Tests:${colors.reset}`);
    failedTests.forEach(({ suite, output }) => {
      console.log(`  • ${suite.name}`);
      if (!args.verbose) {
        console.log(`    ${output.split('\n')[0]}`);
      }
    });
  }

  // Performance summary for completed performance tests
  const performanceResults = results.filter(r => r.suite.type === 'performance' && r.success);
  if (performanceResults.length > 0) {
    console.log(`\n${colors.magenta}Performance Summary:${colors.reset}`);
    performanceResults.forEach(({ suite, duration }) => {
      console.log(`  • ${suite.name}: ${formatDuration(duration)}`);
    });
  }

  console.log('\n' + '═'.repeat(80));

  if (passedTests === totalTests) {
    console.log(`${colors.bright}${colors.green}🎉 All tests passed! The HAG Experimental AI system is ready for deployment.${colors.reset}`);
  } else {
    console.log(`${colors.bright}${colors.red}⚠️  Some tests failed. Please review the results before deployment.${colors.reset}`);
  }

  // Exit with appropriate code
  Deno.exit(passedTests === totalTests ? 0 : 1);
}

if (import.meta.main) {
  await main();
}