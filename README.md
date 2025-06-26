# HAG JavaScript Variant

Home Assistant aGentic HVAC automation system - Traditional TypeScript implementation with JSR-compatible libraries.

## Overview

This is the traditional TypeScript variant of HAG, featuring:
- **Dependency Injection**: @needle-di/core (JSR)
- **Validation**: Zod schemas
- **Logging**: @std/log (JSR)
- **WebSocket**: @std/ws (JSR)
- **CLI**: @cliffy/command (JSR)
- **Testing**: @std/testing (JSR)
- **State Machine**: XState v5

## Features

- ✅ **Type-safe configuration** with Zod validation
- ✅ **XState-powered HVAC state machine** with heating/cooling strategies
- ✅ **WebSocket client** for real-time Home Assistant integration
- ✅ **AI-powered decision making** with LangChain (optional)
- ✅ **Defrost cycle management** with timing constraints
- ✅ **JSR-first dependencies** for future-proof package management
- ✅ **Traditional OOP patterns** familiar to most developers

## Quick Start

### Prerequisites

- Deno 2.x
- Home Assistant instance with WebSocket API access
- OpenAI API key (optional, for AI features)

### Installation

```bash
# Clone and enter the directory
cd hag_js

# Check configuration
deno task check

# Install dependencies (automatic with Deno)
deno cache src/main.ts
```

### Configuration

1. Copy the example configuration:
```bash
cp config/hvac_config.yaml config/my_config.yaml
```

2. Edit `config/my_config.yaml` with your Home Assistant details:
```yaml
hassOptions:
  wsUrl: ws://your-hass-instance:8123/api/websocket
  restUrl: http://your-hass-instance:8123
  token: your_long_lived_access_token

hvacOptions:
  tempSensor: sensor.your_temperature_sensor
  hvacEntities:
    - entityId: climate.your_hvac_device
      enabled: true
```

3. Set environment variables (optional):
```bash
export HASS_TOKEN="your_token"
export HAG_USE_AI="true"           # Enable AI features
export OPENAI_API_KEY="your_key"   # Required for AI
```

### Running

```bash
# Development mode
deno task dev

# With specific config
deno task dev --config config/my_config.yaml

# Build executable
deno task build

# Run tests
deno task test
```

## Architecture

### Dependency Injection

Uses @needle-di/core for type-safe dependency injection:

```typescript
@injectable()
export class HVACController {
  constructor(
    private haClient = inject(HomeAssistantClient),
    private stateMachine = inject(HVACStateMachine),
    private logger = inject(Logger)
  ) {}
}
```

### Configuration

Zod-based schemas ensure type safety:

```typescript
const HvacOptionsSchema = z.object({
  tempSensor: z.string().refine(val => val.startsWith('sensor.')),
  systemMode: z.nativeEnum(SystemMode).default(SystemMode.AUTO),
  // ...
});
```

### Error Handling

Traditional class-based exceptions:

```typescript
export class HAGError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}
```

### State Machine

XState v5 with TypeScript:

```typescript
export const hvacMachine = createMachine({
  id: 'hvac',
  initial: 'idle',
  states: {
    idle: {
      on: {
        HEAT: { target: 'heating', guard: 'canHeat' },
        COOL: { target: 'cooling', guard: 'canCool' }
      }
    },
    heating: { /* ... */ },
    cooling: { /* ... */ },
    defrosting: { /* ... */ }
  }
});
```

## CLI Usage

```bash
# Basic usage
hag

# With options
hag --config my_config.yaml --log-level debug

# Validate configuration
hag --validate-config

# Show status
hag status

# Manual override
hag override heat --temperature 22
```

## Development

### Project Structure

```
src/
├── config/          # Configuration schemas and loading
├── core/            # Core utilities and exceptions
├── home-assistant/  # HA client and models
├── hvac/           # HVAC logic and state machines
│   ├── strategies/ # Heating/cooling strategies
│   └── tools/      # LangChain tools
├── types/          # TypeScript type definitions
└── main.ts         # Application entry point
```

### Testing

```bash
# Run all tests
deno task test

# Run specific test file
deno test tests/unit/test_hvac_controller.ts

# Run with coverage
deno test --coverage
```

### Linting and Formatting

```bash
# Format code
deno task fmt

# Lint code
deno task lint

# Type check
deno task check
```

## JSR Dependencies

This variant prioritizes JSR (JavaScript Registry) packages:

- `@needle-di/core` - Dependency injection
- `@std/testing` - Testing framework
- `@std/log` - Logging
- `@std/ws` - WebSocket client
- `@cliffy/command` - CLI framework

## Migration from Python

This variant provides the closest migration path from the original Python HAG:

1. **Similar patterns**: Class-based OOP with decorators
2. **Familiar DI**: Constructor injection similar to Python dependency-injector
3. **Traditional async/await**: Direct mapping from Python asyncio
4. **Error handling**: Exception classes similar to Python patterns

## License

Same as parent HAG project.