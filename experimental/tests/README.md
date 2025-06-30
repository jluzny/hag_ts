# HAG Experimental Tests

This directory contains tests for experimental features that are not yet part of the core HAG system.

## Directory Structure

```
experimental/tests/
├── unit/                     # Unit tests for experimental features
│   └── ai/
│       └── learning/
│           └── adaptive-learning-engine.test.ts
├── integration/              # Integration tests for experimental features
│   └── adaptive-learning-integration.test.ts
└── README.md                 # This file
```

## Test Categories

### Unit Tests
- **adaptive-learning-engine.test.ts**: Comprehensive unit tests for the adaptive learning engine
  - Configuration and initialization
  - User interaction recording
  - Pattern detection algorithms
  - Personalized recommendation generation
  - Behavioral insights
  - Preference adaptation
  - Edge case handling

### Integration Tests
- **adaptive-learning-integration.test.ts**: Integration tests for learning system components
  - Realistic user behavior simulation
  - Time-based pattern learning
  - Seasonal and occupancy adaptation
  - Continuous learning and adaptation
  - Multi-component interaction

## Running Experimental Tests

```bash
# Run all experimental tests
deno test --allow-all experimental/tests/

# Run only unit tests
deno test --allow-all experimental/tests/unit/

# Run only integration tests
deno test --allow-all experimental/tests/integration/

# Run specific test file
deno test --allow-all experimental/tests/unit/ai/learning/adaptive-learning-engine.test.ts
```

## Test Environment

### Required
- **None** - All tests use mocks and fallbacks

### Optional
- **No external dependencies** - The experimental learning tests are self-contained

## Features Tested

### Adaptive Learning Engine
- ✅ **Pattern Recognition**: Learns from user behavior patterns
- ✅ **Preference Adaptation**: Adapts to changing user preferences
- ✅ **Contextual Recommendations**: Provides personalized recommendations based on context
- ✅ **Behavioral Insights**: Generates insights about user behavior
- ✅ **Temporal Learning**: Adapts to time-based patterns (morning, evening, weekday/weekend)
- ✅ **Seasonal Adaptation**: Learns seasonal preference changes
- ✅ **Continuous Learning**: Updates preferences over time

## Integration with Main System

These experimental tests are separate from the main HAG test suite to:

1. **Isolate experimental features** from production code
2. **Enable rapid experimentation** without affecting core system stability
3. **Provide comprehensive testing** for features under development
4. **Maintain clear separation** between stable and experimental functionality

## Migration Path

When experimental features are ready for production:

1. Move relevant tests to the main `tests/` directory
2. Update import paths to reference `src/` instead of `experimental/src/`
3. Integrate with main test suite and CI/CD pipeline
4. Update main system imports to use the graduated features

## Current Status

- **Adaptive Learning Engine**: Comprehensive test coverage, ready for evaluation
- **Integration Tests**: Realistic scenarios for multi-component learning system
- **All Tests Passing**: ✅ No external dependencies required