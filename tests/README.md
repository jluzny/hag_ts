# HAG JavaScript Variant - Test Suite

This directory contains comprehensive tests for the HAG JavaScript variant using traditional TypeScript patterns with @needle-di dependency injection.

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual components
│   ├── core/               # Core functionality tests
│   │   └── exceptions.test.ts
│   ├── config/             # Configuration schema tests
│   │   └── settings.test.ts
│   └── types/              # Type definition tests
│       └── common.test.ts
├── integration/            # Integration tests
│   └── hvac-integration.test.ts
└── README.md              # This file
```

## Running Tests

### All Tests
```bash
deno task test
```

### Unit Tests Only
```bash
deno task test:unit
```

### Integration Tests Only
```bash
deno task test:integration
```

### Watch Mode (Auto-rerun on changes)
```bash
deno task test:watch
```

### Coverage Report
```bash
deno task test:coverage
```

## Test Categories

### Unit Tests
- **Core Exceptions**: Tests for HAGError, StateError, ValidationError, etc.
- **Configuration Schemas**: Validation of Zod schemas for settings
- **Type Definitions**: Enum values and type structure validation

### Integration Tests
- **HVAC Controller Integration**: Full system integration with mock services
- **State Machine Integration**: XState integration with HVAC logic
- **Configuration Validation**: End-to-end configuration loading and validation

## Test Patterns

### Dependency Injection Testing
Tests use mock implementations of services to isolate components:

```typescript
// Mock Home Assistant client
class MockHomeAssistantClient {
  private _connected = false;
  // ... mock implementation
}

// Replace in container
container.getContainer().rebind(TYPES.HomeAssistantClient).toConstantValue(mockHaClient);
```

### Configuration Testing
Tests validate Zod schemas with both valid and invalid inputs:

```typescript
await t.step('should validate valid HVAC config', () => {
  const validConfig = { /* ... */ };
  const result = HvacOptionsSchema.parse(validConfig);
  assertEquals(result.systemMode, SystemMode.AUTO);
});

await t.step('should reject invalid values', () => {
  const invalidConfig = { /* ... */ };
  assertThrows(() => HvacOptionsSchema.parse(invalidConfig), ZodError);
});
```

### Integration Testing
Tests verify component integration without external dependencies:

```typescript
await t.step('should start and connect to Home Assistant', async () => {
  await controller.start();
  assertEquals(mockHaClient.connected, true);
  
  const status = await controller.getStatus();
  assertEquals(status.controller.running, true);
});
```

## Test Coverage

The test suite covers:

- ✅ **Error Handling**: All exception types and error utilities
- ✅ **Configuration**: Schema validation and defaults
- ✅ **Type Safety**: Enum values and type structures
- ✅ **HVAC Operations**: Manual overrides, evaluations, efficiency analysis
- ✅ **State Management**: State machine transitions and conditions
- ✅ **Home Assistant Integration**: Mock client operations and event handling
- ✅ **Dependency Injection**: Service registration and container management

## Test Data

Tests use realistic mock data that mirrors production scenarios:

```typescript
const mockSettings: Settings = {
  appOptions: {
    logLevel: LogLevel.ERROR, // Reduce noise in tests
    useAi: false,
    // ...
  },
  hvacOptions: {
    tempSensor: 'sensor.indoor_temperature',
    systemMode: SystemMode.AUTO,
    hvacEntities: [
      {
        entityId: 'climate.test_ac',
        enabled: true,
        defrost: false,
      },
    ],
    // ...
  },
};
```

## Contributing

When adding new features:

1. **Add unit tests** for individual components
2. **Add integration tests** for component interactions
3. **Use mock services** to isolate test scenarios
4. **Follow existing patterns** for consistency
5. **Test both success and error cases**

## Performance

Tests are designed to run quickly:
- Use mocks instead of real network calls
- Minimize setup/teardown overhead
- Run tests in parallel where possible
- Focus on essential scenarios