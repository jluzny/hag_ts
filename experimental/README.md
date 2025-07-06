# Experimental Features

This directory contains experimental implementations and alternative approaches that are not part of the main HAG application.

## Directory Structure

### Core Experimental Features
- `src/core/experimental-features.ts` - Experimental features interface definitions
- `src/core/experimental-container.ts` - Dependency injection container for experimental features

### AI Experimental Features
- `src/ai/decision-engine.ts` - AI-powered decision engine using LangChain/OpenAI (alternative to rule-based logic)
- Plus various AI modules for learning, monitoring, optimization, predictive analytics, and scheduling

### LangGraph State Machine (Alternative Implementation)
- `src/hvac/state-machine-lg-adapter.ts` - LangGraph state machine adapter
- `src/hvac/state-machine-lg-v2.ts` - LangGraph state machine implementation v2
- `src/hvac/lg-nodes/` - LangGraph node implementations:
  - `ai-evaluation-node.ts`
  - `cooling-node.ts`
  - `evaluation-node.ts`
  - `heating-node.ts`
  - `idle-node.ts`
  - `off-node.ts`
- `src/hvac/lg-types/hvac-state.ts` - Type definitions for LangGraph state machine

### Home Assistant Experimental Features
- `src/home-assistant/event-factory.ts` - Event factory for converting raw HA events (experimental pattern)

## Important Notes

⚠️ **The main application NEVER references experimental code**

- Main codebase uses XState actor system as the primary approach
- LangGraph implementation is experimental and for future consideration
- AI features are experimental and may require additional configuration
- All experimental features are self-contained and do not affect main functionality

## Testing

Experimental features have their own test suite in `experimental/tests/`.

## Usage

Experimental features are designed for:
- Future development and research
- Alternative architectural approaches
- Advanced AI/ML capabilities
- Performance experimentation

They should not be enabled in production environments without thorough testing.