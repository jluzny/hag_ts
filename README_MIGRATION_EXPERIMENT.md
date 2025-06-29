# XState → LangGraph Migration Experiment

## Overview

This branch contains an experimental migration from XState to LangGraph for the HAG HVAC automation system. The goal is to explore whether LangGraph can serve as a drop-in replacement for XState while potentially adding AI-driven capabilities.

## Quick Start

### 1. Switch to LangGraph Dependencies
```bash
# Backup current deno.json
cp deno.json deno.json.xstate

# Use LangGraph-enabled configuration
cp deno.json.langgraph deno.json
```

### 2. Run with Feature Flag
```bash
# Test LangGraph implementation
deno task dev --config config/hvac_config.yaml

# The system will use XState by default. To enable LangGraph:
# Edit config/hvac_config.yaml and add:
# appOptions:
#   useLangGraphStateMachine: true
```

### 3. Compare Implementations
```bash
# Run tests for both implementations
deno task test:unit

# Specific LangGraph tests
deno test -A tests/unit/hvac/state-machine-lg.test.ts
```

## What's Been Implemented

### ✅ Phase 1: Foundation (Current)
- [x] Directory structure created
- [x] LangGraph dependencies added
- [x] Type definitions for HVACLangGraphState
- [x] Basic evaluation node implementation
- [x] Migration plan documented

### 🔄 Phase 2: Core Implementation (Next)
- [ ] Complete all LangGraph nodes (heating, cooling, idle)
- [ ] Graph construction and routing logic
- [ ] State machine interface abstraction
- [ ] Feature flag integration in controller

### ⏳ Phase 3-5: Future Phases
- Integration & Testing
- AI Enhancement
- Performance & Monitoring

## Key Files

### Migration Documentation
- `MIGRATION_PLAN_XSTATE_TO_LANGGRAPH.md` - Comprehensive migration plan
- `README_MIGRATION_EXPERIMENT.md` - This file

### LangGraph Implementation
- `src/hvac/lg-types/hvac-state.ts` - State type definitions
- `src/hvac/lg-nodes/evaluation-node.ts` - Core evaluation logic
- `src/hvac/lg-nodes/` - Individual node implementations (WIP)
- `src/hvac/state-machine-lg.ts` - Main LangGraph state machine (TODO)

### Configuration
- `deno.json.langgraph` - Dependencies with LangGraph support
- `deno.json.xstate` - Original XState-only dependencies

## Architecture Comparison

### XState (Current)
```typescript
// Simple state machine with guards
idle → evaluating → heating/cooling/off
```

### LangGraph (Experimental)
```typescript
// Graph-based with node functions
evaluationNode → heatingNode/coolingNode/idleNode → evaluationNode
```

## Key Differences

| Aspect | XState | LangGraph |
|--------|--------|-----------|
| **State Model** | Finite state machine | Graph of functions |
| **Transitions** | Event-driven | Function-to-function |
| **Context** | Single context object | Message-passing state |
| **AI Integration** | Manual | Built-in capabilities |
| **Debugging** | Visual state charts | Graph execution traces |
| **Performance** | Very fast | Moderate (more overhead) |

## Benefits of LangGraph

1. **AI-Ready Architecture**: Native support for LLM integration
2. **Rich State History**: Built-in evaluation history tracking
3. **Flexible Routing**: Dynamic graph execution paths
4. **Enhanced Monitoring**: Detailed performance metrics
5. **Future Extensibility**: Easy to add AI decision nodes

## Potential Drawbacks

1. **Complexity**: More complex than XState for simple logic
2. **Performance**: Additional overhead from graph execution
3. **Dependencies**: Brings in LangChain ecosystem
4. **Learning Curve**: New concepts for team to learn

## Testing the Migration

### Current Status Tests
```bash
# Verify both implementations work
deno task test:unit

# Test specific evaluation logic
deno test -A tests/unit/hvac/lg-nodes/evaluation-node.test.ts
```

### Performance Comparison
```bash
# Benchmark both implementations (when complete)
deno run -A scripts/benchmark-state-machines.ts
```

## Rollback Strategy

If the experiment doesn't work out:

```bash
# 1. Restore original dependencies
cp deno.json.xstate deno.json

# 2. Ensure feature flag is disabled in config
# appOptions:
#   useLangGraphStateMachine: false  # or remove entirely

# 3. System automatically uses XState implementation
deno task dev
```

## Next Steps

1. **Complete Phase 2**: Implement remaining LangGraph nodes
2. **Integration**: Connect LangGraph to existing controller
3. **Testing**: Comprehensive test suite for both implementations
4. **Performance**: Benchmark and optimize LangGraph version
5. **AI Enhancement**: Add intelligent decision-making capabilities

## Contributing to the Experiment

When working on this branch:

1. Preserve the existing XState implementation
2. Use feature flags to switch between implementations
3. Maintain backward compatibility
4. Add tests for new LangGraph functionality
5. Document performance implications

## Questions & Feedback

This is an experimental branch. Key questions to evaluate:

1. Does LangGraph provide equivalent functionality to XState?
2. What is the performance impact of the migration?
3. Do the AI capabilities justify the added complexity?
4. How difficult is it for the team to work with LangGraph?
5. Are there use cases where LangGraph is clearly superior?

---

**Remember**: This is an experiment. The goal is learning, not necessarily adopting LangGraph. The existing XState implementation remains the production system until this experiment proves conclusively beneficial.