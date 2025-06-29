# HAG Development Scripts

This directory contains helper utilities and interactive tools for HAG system
validation and debugging.

## Organization

**Tests have been moved to the `tests/` directory for better organization:**

- `tests/ai/` - AI component tests
- `tests/integration/` - Integration and Home Assistant tests
- `tests/performance/` - Performance benchmarks
- `tests/system/` - System validation tests

**Scripts now contain only helper utilities for prompt-driven validation.**

## Available Scripts

### Interactive Validation

- `interactive_validator.ts` - Interactive system validation with user prompts
- `validation_helpers.ts` - Utility functions for validation and health checking

### Home Assistant Utilities

- `list_entities.ts` - List all available Home Assistant entities
- `call_service.ts` - Call Home Assistant services directly
- `check_hvac_status.ts` - Check current HVAC system status
- `debug_websocket.ts` - Debug WebSocket connection issues

### Development Utilities

- `debug_langgraph_api.ts` - Debug LangGraph API compatibility issues
- `hvac_prompts.md` - Documentation for HVAC-related prompts and scenarios

## Usage

### Interactive Validation

Run the interactive validator for step-by-step system validation:

```bash
deno run --allow-all scripts/interactive_validator.ts
```

This will guide you through:

- System requirements checking
- Network connectivity testing
- Configuration file validation
- Home Assistant connectivity
- AI components availability
- Binary validation

### Direct Utilities

```bash
# List Home Assistant entities
HASS_URL=http://homeassistant.local:8123 HASS_TOKEN=your_token deno run --allow-all scripts/list_entities.ts

# Check HVAC status
deno run --allow-all scripts/check_hvac_status.ts

# Debug WebSocket connection
deno run --allow-all scripts/debug_websocket.ts
```

### Running Tests

For comprehensive automated testing, use the test scripts:

```bash
# Run all tests
deno task test

# Run specific test categories
deno run --allow-all tests/ai/test_ai_decision_engine.ts
deno run --allow-all tests/system/test_production_readiness.ts
deno run --allow-all tests/performance/benchmark_state_machines.ts
```

## Environment Variables

Scripts require these environment variables:

- `HASS_URL` - Home Assistant URL (e.g., http://homeassistant.local:8123)
- `HASS_TOKEN` - Long-lived access token from Home Assistant
- `OPENAI_API_KEY` - OpenAI API key for AI functionality (optional)

## Script Categories

### 🔍 **Interactive Validation**

User-guided validation tools for system setup and troubleshooting.

### 🏠 **Home Assistant Utilities**

Direct integration tools for debugging Home Assistant connectivity.

### 🛠️ **Development Utilities**

Low-level debugging and development support tools.

### 🧪 **Testing (Moved to tests/)**

All comprehensive test suites have been moved to the `tests/` directory for
better organization and automated test running.

## Quick Reference

```bash
# Interactive validation (recommended for first-time setup)
deno run --allow-all scripts/interactive_validator.ts

# List available Home Assistant entities
deno run --allow-all scripts/list_entities.ts

# Debug WebSocket connectivity
deno run --allow-all scripts/debug_websocket.ts

# Run comprehensive test suite
deno task test
```

## Example Interactive Session

```bash
$ deno run --allow-all scripts/interactive_validator.ts
🚀 HAG Interactive System Validator
===================================

🔍 Check system requirements?
Enter "y" to confirm, any other key to skip:
y

📊 System Requirements
==================================================
✅ Deno Runtime
   Version: 2.0.0
✅ Environment Variable: HOME
   Set
✅ File System Access
   Read/write permissions available

📈 Success Rate: 100% (3/3)

⏸️  Press Enter to continue...
```
