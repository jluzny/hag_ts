# Actor System Refactoring - Generic Event-Driven Architecture

## Overview

This document describes the refactoring of the HAG HVAC system's actor architecture to create a generic, event-driven actor bootstrap system that separates domain-specific logic from core infrastructure.

## Problem Statement

The original actor system had several architectural issues:

1. **HVAC-specific logic embedded in core actor system** - Made it difficult to add new domains
2. **Dual state machine implementations** - Confusion between XState and custom actor implementations
3. **Tight coupling** - Hard to test and extend individual components
4. **No standardized actor interface** - Inconsistent actor implementations

## Solution Architecture

### 1. Generic Actor Bootstrap System

**File**: `src/core/actor-bootstrap.ts`

- **ActorBootstrap**: Central registry and lifecycle manager for domain actors
- **DomainActor Interface**: Standardized contract for all domain-specific actors
- **ActorFactory Interface**: Factory pattern for creating and validating actors
- **Event-driven communication**: Actors communicate via typed events

```typescript
interface DomainActor {
  readonly name: string;
  readonly domain: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  getStatus(): ActorStatus;
  handleEvent?(event: BaseEvent): Promise<void> | void;
}
```

### 2. HVAC Domain Actor Implementation

**File**: `src/hvac/hvac-domain-actor.ts`

- **HvacDomainActor**: HVAC-specific implementation of DomainActor
- **HvacActorFactory**: Factory for creating HVAC actors with configuration validation
- **Event handling**: Responds to temperature updates, mode changes, and system events

### 3. Event-Driven Controller

**File**: `src/hvac/controller-v2.ts`

- **HVACControllerV2**: Demonstrates event-driven architecture
- **Temperature monitoring**: Publishes temperature update events
- **Manual overrides**: Uses events instead of direct method calls
- **Decoupled communication**: Controller and actors communicate only via events

## Key Improvements

### 1. Separation of Concerns

- **Core actor system** (`ActorSystem`) is now completely domain-agnostic
- **Actor bootstrap** (`ActorBootstrap`) handles generic lifecycle management
- **Domain actors** contain only domain-specific logic

### 2. Event-Driven Architecture

```typescript
// Temperature updates via events
const temperatureEvent = new TemperatureUpdateEvent(indoor, outdoor);
eventBus.publishEvent(temperatureEvent);

// Mode changes via events
const modeEvent = new ModeChangeRequestEvent('cool', 24);
eventBus.publishEvent(modeEvent);
```

### 3. Standardized Lifecycle Management

```typescript
// Register actor factory
const hvacFactory = new HvacActorFactory();
actorBootstrap.registerActorFactory(hvacFactory, config);

// Start all actors
await actorBootstrap.startAll();

// Get actor status
const status = actorBootstrap.getActorStatus('hvac');
```

### 4. Type-Safe Configuration

```typescript
interface HvacActorConfig {
  hvacOptions: HvacOptions;
  haClient: HomeAssistantClient;
}

// Factory validates configuration
validateConfig(config: unknown): boolean {
  const hvacConfig = config as HvacActorConfig;
  return !!(hvacConfig?.hvacOptions?.tempSensor);
}
```

## Benefits

### 1. **Extensibility**
- Easy to add new domain actors (lighting, security, etc.)
- Standardized interface ensures consistency
- Factory pattern simplifies actor creation

### 2. **Testability**
- Each component can be tested in isolation
- Mock actors for testing controller logic
- Event-driven communication is easy to test

### 3. **Maintainability**
- Clear separation between infrastructure and domain logic
- Standardized error handling and status reporting
- Consistent lifecycle management

### 4. **Scalability**
- Multiple actors can run concurrently
- Event-driven communication prevents blocking
- Easy to add monitoring and metrics

## Usage Examples

### Adding a New Domain Actor

```typescript
// 1. Implement DomainActor interface
class LightingDomainActor implements DomainActor {
  readonly name = 'lighting-controller';
  readonly domain = 'lighting';
  
  async start() { /* lighting-specific startup */ }
  async stop() { /* lighting-specific cleanup */ }
  getStatus() { /* return lighting status */ }
  async handleEvent(event) { /* handle lighting events */ }
}

// 2. Create factory
class LightingActorFactory implements ActorFactory<LightingDomainActor> {
  readonly domain = 'lighting';
  create(config) { return new LightingDomainActor(config); }
  validateConfig(config) { /* validate lighting config */ }
}

// 3. Register with bootstrap
const factory = new LightingActorFactory();
actorBootstrap.registerActorFactory(factory, lightingConfig);
```

### Event-Driven Communication

```typescript
// Publish domain-specific events
eventBus.publishEvent(new LightingBrightnessEvent(75));
eventBus.publishEvent(new LightingColorEvent('#FF0000'));

// Actors automatically receive relevant events
async handleEvent(event: BaseEvent) {
  switch (event.type) {
    case 'lighting.brightness':
      await this.setBrightness(event.payload.level);
      break;
    case 'lighting.color':
      await this.setColor(event.payload.color);
      break;
  }
}
```

## Migration Path

### Current Implementation (Preserved)
- `HVACController` - Original implementation still works
- `HvacActorService` - Existing service layer maintained
- All existing tests pass

### New Implementation (Available)
- `HVACControllerV2` - Event-driven implementation
- `HvacDomainActor` - Generic actor framework implementation
- `ActorBootstrap` - New infrastructure layer

### Gradual Migration
1. **Phase 1**: Use new system for new features
2. **Phase 2**: Migrate existing features to event-driven approach
3. **Phase 3**: Deprecate old implementation when fully migrated

## Testing

### Comprehensive Test Suite
- **Actor Bootstrap Tests**: Lifecycle, event handling, error scenarios
- **HVAC Domain Actor Tests**: HVAC-specific functionality
- **Integration Tests**: End-to-end event flow
- **All existing tests**: Continue to pass

### Test Coverage
```bash
deno test tests/unit/core/actor-bootstrap.test.ts
# ✅ 4 tests passed - Basic lifecycle, event handling, multiple actors, error handling
```

## Future Enhancements

### 1. **Actor Discovery**
- Dynamic actor registration
- Service discovery mechanisms
- Health checks and monitoring

### 2. **Event Routing**
- Advanced event filtering
- Event transformation pipelines
- Event persistence and replay

### 3. **Performance Optimization**
- Actor pooling
- Event batching
- Async event processing

### 4. **Monitoring & Observability**
- Actor performance metrics
- Event flow tracing
- Health dashboards

## Conclusion

The refactored actor system provides a solid foundation for building scalable, maintainable, and testable domain-specific automation systems. The generic actor bootstrap framework enables rapid development of new automation domains while maintaining clean separation of concerns and event-driven communication patterns.

The HVAC implementation serves as a reference implementation demonstrating best practices for using the new architecture, while maintaining backward compatibility with existing systems.