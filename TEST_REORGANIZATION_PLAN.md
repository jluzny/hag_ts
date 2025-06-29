# HAG Test Reorganization Plan

## Current Issues

### 1. Inconsistent Naming

- Mix of `test_*.ts` (script style) and `*.test.ts` (unit test style)
- Need consistent naming across all tests

### 2. Import Path Issues

- Many moved tests still have wrong import paths
- Need to fix all `../src/` to `../../src/` in moved tests

### 3. Missing Test Coverage

- No tests for: `performance-optimizer.ts`, `system-monitor.ts`, `dashboard.ts`
- Incomplete coverage for AI modules

### 4. Unrunnable Tests

- LangGraph tests reference broken implementations
- Need to disable or fix these

## New Test Structure

### Unit Tests (tests/unit/) - *.test.ts format

```
tests/unit/
├── ai/
│   ├── agent.test.ts                    ✅ EXISTS (fix imports)
│   ├── decision-engine.test.ts          ❌ CREATE NEW
│   ├── adaptive-learning.test.ts        ❌ CREATE NEW  
│   ├── hvac-optimizer.test.ts           ❌ CREATE NEW
│   ├── predictive-analytics.test.ts     ❌ CREATE NEW
│   ├── smart-scheduler.test.ts          ❌ CREATE NEW
│   ├── performance-optimizer.test.ts    ❌ CREATE NEW
│   ├── system-monitor.test.ts           ❌ CREATE NEW
│   └── dashboard.test.ts                ❌ CREATE NEW
├── config/
│   ├── loader.test.ts                   ✅ EXISTS (good)
│   └── settings.test.ts                 ✅ EXISTS (good)
├── core/
│   ├── container.test.ts                ✅ EXISTS (good)
│   ├── exceptions.test.ts               ✅ EXISTS (good)
│   ├── logger.test.ts                   ❌ CREATE NEW
│   └── production-validator.test.ts     ❌ CREATE NEW
├── home-assistant/
│   ├── client.test.ts                   ✅ EXISTS (good)
│   └── models.test.ts                   ❌ CREATE NEW
├── hvac/
│   ├── controller.test.ts               ✅ EXISTS (fix imports)
│   ├── cooling-strategy.test.ts         ✅ EXISTS (good)
│   ├── heating-strategy.test.ts         ✅ EXISTS (good)
│   └── state-machine.test.ts            ✅ EXISTS (good)
└── types/
    └── common.test.ts                   ✅ EXISTS (good)
```

### Integration Tests (tests/integration/) - *.integration.test.ts format

```
tests/integration/
├── hvac-system.integration.test.ts      ✅ EXISTS (rename from hvac-integration.test.ts)
├── home-assistant.integration.test.ts   ❌ CONSOLIDATE (from test_ha_connection.ts, test_sensors.ts, test_rest_api.ts)
└── ai-system.integration.test.ts        ❌ CREATE NEW (full AI system integration)
```

### System Tests (tests/system/) - *.system.test.ts format

```
tests/system/
├── production-readiness.system.test.ts  ✅ EXISTS (rename + fix imports)
└── deployment-validation.system.test.ts ❌ CREATE NEW
```

### Performance Tests (tests/performance/) - *.perf.test.ts format

```
tests/performance/
├── state-machine.perf.test.ts           ✅ EXISTS (rename from benchmark_state_machines.ts)
├── ai-components.perf.test.ts           ❌ CREATE NEW
└── system-throughput.perf.test.ts       ❌ CREATE NEW
```

### E2E Tests (tests/e2e/) - *.e2e.test.ts format

```
tests/e2e/
├── hvac-automation.e2e.test.ts          ❌ CREATE NEW
└── ai-decision-flow.e2e.test.ts         ❌ CREATE NEW
```

## Module Coverage Matrix

| Module                                   | Unit Test | Integration Test | Performance Test | Notes                    |
| ---------------------------------------- | --------- | ---------------- | ---------------- | ------------------------ |
| ai/agent.ts                              | ✅        | ✅               | ✅               | Core AI functionality    |
| ai/decision-engine.ts                    | ❌        | ✅               | ✅               | Critical AI component    |
| ai/learning/adaptive-learning-engine.ts  | ❌        | ✅               | ❌               | Learning capabilities    |
| ai/monitoring/dashboard.ts               | ❌        | ❌               | ❌               | Dashboard functionality  |
| ai/monitoring/system-monitor.ts          | ❌        | ❌               | ❌               | System monitoring        |
| ai/optimization/hvac-optimizer.ts        | ❌        | ✅               | ❌               | Optimization algorithms  |
| ai/optimization/performance-optimizer.ts | ❌        | ✅               | ❌               | Performance optimization |
| ai/predictive/analytics-engine.ts        | ❌        | ✅               | ❌               | Predictive analytics     |
| ai/scheduling/smart-scheduler.ts         | ❌        | ✅               | ❌               | Smart scheduling         |
| config/loader.ts                         | ✅        | ❌               | ❌               | Configuration loading    |
| config/config.ts                         | ✅        | ❌               | ❌               | Configuration schemas    |
| core/container.ts                        | ✅        | ✅               | ❌               | Dependency injection     |
| core/exceptions.ts                       | ✅        | ❌               | ❌               | Error handling           |
| core/logger.ts                           | ❌        | ❌               | ❌               | Logging system           |
| core/production-validator.ts             | ❌        | ✅               | ❌               | Production validation    |
| home-assistant/client.ts                 | ✅        | ✅               | ❌               | HA client                |
| home-assistant/models.ts                 | ❌        | ❌               | ❌               | HA models                |
| hvac/controller.ts                       | ✅        | ✅               | ❌               | HVAC controller          |
| hvac/state-machine.ts                    | ✅        | ✅               | ✅               | State machine            |
| main.ts                                  | ❌        | ✅               | ❌               | CLI entry point          |
| types/common.ts                          | ✅        | ❌               | ❌               | Type definitions         |

## Actions Required

### 1. Remove Unrunnable Tests

- Delete all LangGraph tests (broken implementations)
- Remove: `tests/integration/langgraph/` directory

### 2. Rename Existing Tests

- Rename script-style tests to unit test format
- Fix import paths in all moved tests
- Standardize naming convention

### 3. Create Missing Tests

- 9 new unit tests needed for AI modules
- 3 new integration tests needed
- 2 new performance tests needed
- 2 new E2E tests needed

### 4. Fix Import Paths

- Update all `../src/` to `../../src/` in moved tests
- Verify all imports resolve correctly

### 5. Test Consolidation

- Merge related tests (HA connection tests)
- Remove duplicate coverage
- Ensure comprehensive coverage

## Priority Order

1. **HIGH**: Fix existing working tests (import paths, naming)
2. **HIGH**: Create critical missing unit tests (decision-engine, core modules)
3. **MEDIUM**: Create integration tests for AI system
4. **MEDIUM**: Create performance tests for AI components
5. **LOW**: Create E2E tests for full workflows

## Validation Criteria

- [ ] All tests use consistent naming convention
- [ ] All import paths resolve correctly
- [ ] All source modules have unit test coverage
- [ ] Integration tests cover module interactions
- [ ] Performance tests cover critical paths
- [ ] All tests can run successfully
- [ ] Test coverage reports show >90% coverage
