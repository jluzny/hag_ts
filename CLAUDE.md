# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# HAG Project - Claude Development Notes

## Project Overview

HAG (Home Assistant aGentic HVAC Automation) is a TypeScript/Bun application that provides intelligent HVAC control through Home Assistant integration with optional AI-powered decision making.

This is the main HAG implementation using TypeScript with Bun runtime for optimal performance. A Deno variant is available at hag_ts_deno for comparison and experimentation.

## Current Architecture

- **Runtime**: Bun v1.2.18
- **Language**: TypeScript with experimental decorators
- **Dependency Injection**: @needle-di/core for type-safe DI
- **State Management**: XState v5 for HVAC state machine
- **AI Integration**: LangChain v0.3 with OpenAI for intelligent decisions
- **CLI Framework**: @std/cli (via npm:@jsr/std__cli)
- **Configuration**: Zod schemas with YAML/environment variable support

## Development Commands

### Core Development

```bash
bun run dev                  # Development mode
bun run dev:watch            # Development with file watching
bun run prod                 # Production mode
bun run prod:build           # Build for production
```

### HVAC Testing Scripts

The `scripts/` directory contains testing utilities that automatically load configuration from `config/hvac_config_dev.yaml`. All scripts use the correct Home Assistant URLs and authentication tokens from the config.

```bash
# Service calls - control HVAC entities directly
bun run scripts/call_service.ts <domain>.<service> [--entity_id <entity>] [--key value]
bun run scripts/call_service.ts climate.turn_off --entity_id climate.living_room_ac
bun run scripts/call_service.ts climate.set_hvac_mode --entity_id climate.living_room_ac --hvac_mode cool

# Status checking - validate current system state
bun run scripts/check_hvac_status.ts              # Check all configured HVAC entities
bun run scripts/list_entities.ts climate          # Discover available climate entities
bun run scripts/discover_sensors.ts               # Find temperature/outdoor sensors

# Testing prompts - see scripts/hvac_prompts.md for test sequences
# Scripts support timeout commands and can be chained for complex test scenarios
```

### Testing Methodology

For testing HVAC automation behavior:
1. Use service calls to set initial HVAC states
2. Run the app with timeout to observe decision-making
3. Validate final states match expected behavior
4. Check logs for human-readable decision explanations

### Testing

```bash
bun test                     # All tests
bun run test:unit            # Unit tests only
bun run test:integration     # Integration tests only
bun run test:performance     # Performance tests only
bun run test:watch           # Watch mode
bun run test:coverage        # With coverage
```

### Quality & Build

```bash
bun run build               # Build application
bun run check               # TypeScript type checking
bun run fmt                 # Format code (Prettier)
bun run lint                # Lint code (ESLint)
bun run ci                  # Full CI pipeline
```

## Key Dependencies & Versions

### Core Dependencies

- `xstate`: ^5.20.1 (state machine)
- `@langchain/core`: ^0.3.62 (AI framework)
- `@langchain/openai`: ^0.5.18 (OpenAI integration)
- `langchain`: ^0.3.29 (main library)
- `@needle-di/core`: ^1.0.0 (dependency injection)
- `zod`: ^4.0.4 (schema validation)
- `yaml`: ^2.8.0 (configuration parsing)

### Bun-Specific Dependencies

- `@std/cli`: npm:@jsr/std__cli@^1.0.20 (CLI framework)
- `@std/assert`: npm:@jsr/std__assert@^1.0.13 (assertions)
- `@std/log`: npm:@jsr/std__log@^0.224.14 (logging)
- `dotenv`: ^17.2.0 (environment variables)
- `minimist`: ^1.2.8 (argument parsing)

### Development Dependencies

- `@types/bun`: latest (Bun type definitions)
- `typescript`: ^5.8.3 (TypeScript compiler)
- `eslint`: ^9.30.1 (linting)
- `prettier`: ^3.6.2 (formatting)
- `vitest`: ^3.2.4 (additional testing utilities)

## Configuration Structure

### Main Configuration Files

- `package.json`: Dependencies, scripts, metadata
- `tsconfig.json`: TypeScript compiler options
- `bun.lock`: Dependency lock file
- `eslint.config.js`: ESLint configuration

### Application Configuration

- `src/config/config.ts`: Zod validation schemas
- `config/hvac_config_*.yaml`: Environment-specific configs
- `.env`: Environment variables

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["bun-types"]
  }
}
```

## Project Structure

```
src/
├── ai/                     # LangChain AI agent implementation
│   ├── types/             # AI-specific types
│   └── agent.ts           # Main AI agent
├── config/                # Configuration loading and validation
│   ├── config.ts          # Zod schemas
│   └── loader.ts          # Configuration loader
├── core/                  # Core system components
│   ├── container.ts       # DI container
│   ├── event-system.ts    # Event bus
│   ├── exceptions.ts      # Custom exceptions
│   ├── logging.ts         # Logging setup
│   ├── module-registry.ts # Module registration
│   └── types.ts           # Core types
├── home-assistant/        # Home Assistant integration
│   ├── client-xs.ts       # HA WebSocket/REST client (XState)
│   ├── client.ts          # HA WebSocket/REST client
│   └── models.ts          # HA data models
├── hvac/                  # HVAC control logic
│   ├── controller.ts      # Main HVAC controller
│   ├── hvac-module.ts     # HVAC module registration
│   └── state-machine.ts   # XState state machine
├── types/                 # Shared TypeScript types
│   └── common.ts          # Common type definitions
└── main.ts                # CLI entry point
```

## Testing Architecture

```
tests/
├── unit/                  # Component unit tests
│   ├── ai/               # AI component tests
│   ├── config/           # Configuration tests
│   ├── core/             # Core system tests
│   ├── home-assistant/   # HA client tests
│   ├── hvac/             # HVAC logic tests
│   └── types/            # Type definition tests
├── integration/          # System integration tests
│   ├── home-assistant.integration.test.ts
│   └── hvac-system.integration.test.ts
└── performance/          # Performance benchmarks
    └── state-machine.perf.test.ts
```

## Development Guidelines

### Dependency Injection Pattern

```typescript
// Service registration
this.container.bind({ provide: TYPES.Service, useClass: ServiceClass });
this.container.bind({ provide: TYPES.Config, useValue: configObject });

// Service injection
constructor(
  @inject(TYPES.Service) private service: ServiceType,
) {}
```

### Error Handling

- Use `{ error }` object wrapping for logger methods
- Check `error instanceof Error` before accessing `.name` property
- Use `import type` for decorator parameter types to avoid metadata issues

### Type Safety

- Use `import type` for types used only in decorators
- Cast types as `any` when needed for library compatibility (e.g., LangChain)
- Add `override` modifier for inherited properties like `Error.cause`

## Common Issues & Solutions

### Build Warnings

- `experimentalDecorators` deprecation warning is expected and unavoidable
- Required for @needle-di/core dependency injection to work
- Will need library updates when new decorator standard is finalized

### Bun-Specific Considerations

- Use `bun run check` for TypeScript type checking
- Bun's fast startup and execution improve development experience
- Native support for TypeScript without transpilation step
- Built-in test runner with Jest-compatible API

### WebSocket Connection

- Native WebSocket API requires different error handling pattern
- Use event listeners instead of async iteration
- Connection state management needs manual tracking

## Performance Optimizations

### Bun Runtime Benefits

- Fast startup time compared to Node.js
- Built-in bundler and transpiler
- Optimized package installation and resolution
- Native TypeScript support

### Application Optimizations

- XState v5 for efficient state management
- Dependency injection for loose coupling
- Event-driven architecture for responsiveness
- Caching strategies for Home Assistant API calls

## Deployment

### Build Process

```bash
bun run prod:build         # Build optimized bundle
bun run prod:start         # Start production server
```

### Production Configuration

- Environment-specific YAML configs
- Secure token management via environment variables
- Logging configuration for production monitoring
- Health check endpoints for system monitoring