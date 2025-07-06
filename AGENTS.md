# HAG Project - Development Guide

## Project Overview

HAG (Home Assistant aGentic HVAC Automation) is a TypeScript/Deno application
that provides intelligent HVAC control through Home Assistant integration with
optional AI-powered decision making.

## Architecture

- **Language**: TypeScript with Deno runtime
- **Dependency Injection**: @needle-di/core for type-safe DI
- **State Management**: XState v5 for HVAC state machine
- **AI Integration**: LangChain v0.3 with OpenAI for intelligent decisions
- **CLI Framework**: @std/cli for command-line interface
- **Configuration**: Zod schemas with YAML/environment variable support

## Key Dependencies & Versions

- `xstate`: ^5.20.0 (state machine)
- `@langchain/core`: ^0.3.61 (AI framework)
- `@langchain/openai`: ^0.5.16 (OpenAI integration)
- `langchain`: ^0.3.29 (main library)
- `@needle-di/core`: ^1.0.0 (dependency injection)
- `@std/cli`: ^1.0.20 (CLI framework)
- `zod`: ^3.25.67 (schema validation)
- `yaml`: ^2.8.0 (configuration parsing)

## Build & Development Commands

```bash
# Development
deno task dev                 # Run in development mode
deno task test               # Run all tests
deno task test:unit          # Run unit tests only
deno task test:integration   # Run integration tests only
deno task test:watch         # Run tests in watch mode

# Build & Quality
deno task build              # Compile binary (with --no-check)
deno task check              # Type check all files
deno task fmt                # Format code
deno task lint               # Lint code

# Testing & Coverage
deno task test:coverage      # Run tests with coverage report
```

## Configuration Structure

- **Main config**: `deno.json` (compiler options, dependencies, tasks)
- **Settings schema**: `src/config/settings.ts` (Zod validation)
- **Default values**: Includes placeholder Home Assistant URLs and sensors
- **Environment**: `.env` file support for sensitive values

## Key Technical Details

### TypeScript Configuration

- Uses `experimentalDecorators: true` for dependency injection
- `emitDecoratorMetadata: true` required for @needle-di/core
- `--no-check` flag used in build to avoid type checking issues during
  compilation

### Dependency Injection Pattern

```typescript
// Service registration (new @needle-di/core API)
this.container.bind({ provide: TYPES.Service, useClass: ServiceClass });
this.container.bind({ provide: TYPES.Config, useValue: configObject });

// Service injection
constructor(
  @inject(TYPES.Service) private service: ServiceType,
) {}
```

### XState v5 Changes

- Replace `spawn(machine)` with `createActor(machine)`
- Call `actor.start()` explicitly after creation
- Updated event handling for type safety

### WebSocket Implementation

- Replaced deprecated `@std/ws` with native WebSocket API
- Uses event-driven pattern (onopen, onmessage, onerror, onclose)

### Configuration Defaults

Required properties that must be included in `defaultSettings`:

- `hassOptions.wsUrl`, `hassOptions.restUrl`, `hassOptions.token`
- `hvacOptions.tempSensor`, `hvacOptions.outdoorSensor`
- `hvacOptions.heating.temperatureThresholds`
- `hvacOptions.cooling.temperatureThresholds`

## Development Guidelines

### Commit Messages

- Use conventional commit format: `type: description`
- Focus on technical changes and business value
- Keep commit messages professional and focused on the technical implementation
- Example: `feat: upgrade dependencies to latest versions`
- **Commit Messages**: Do not mention opencode in commit messages.

### Error Handling

- Use `{ error }` object wrapping for logger methods
- Check `error instanceof Error` before accessing `.name` property
- Use `import type` for decorator parameter types to avoid metadata issues

### Deno Imports

- Always use `jsr` packages for imports, as defined in `deno.json`.
- Do not use `deno.land` URLs for imports.

### Type Safety


- Use `import type` for types used only in decorators
- Cast types as `any` when needed for library compatibility (e.g., LangChain)
- Add `override` modifier for inherited properties like `Error.cause`

## Common Issues & Solutions

### Build Warnings

- `experimentalDecorators` deprecation warning is expected and unavoidable
- Required for @needle-di/core dependency injection to work
- Will need library updates when new decorator standard is finalized

### Type Checking

- Use `--no-check` flag for compilation to avoid complex type issues
- Separate type checking with `deno task check` for development
- Some type casts (`as any`) are necessary for library compatibility

### WebSocket Connection

- Native WebSocket API requires different error handling pattern
- Use event listeners instead of async iteration
- Connection state management needs manual tracking

## Project Structure

```
src/
├── ai/           # LangChain AI agent implementation
├── config/       # Configuration loading and validation
├── core/         # Dependency injection, exceptions, logging
├── home-assistant/ # Home Assistant client and models
├── hvac/         # HVAC controller and state machine
├── types/        # Shared TypeScript types
└── main.ts       # CLI entry point
```

## Testing Strategy

- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- Use Deno's built-in test runner
- Mock external dependencies (Home Assistant, OpenAI)

## Deployment

- Compiles to single binary `hag` (approximately 39MB)
- Includes all dependencies and Deno runtime
- Cross-platform executable
- Configuration via YAML files and environment variables
