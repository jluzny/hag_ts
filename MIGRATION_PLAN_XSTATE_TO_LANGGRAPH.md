# XState to LangGraph Migration Plan

## Overview

This document outlines the experimental migration from XState to LangGraph for the HAG HVAC automation system. This migration explores using LangGraph's state machine capabilities while potentially adding AI-driven decision making.

## Current XState Implementation Analysis

### Current State Machine Structure
```typescript
// Current XState HVAC State Machine (src/hvac/state-machine.ts)
States: idle → evaluating → heating/cooling/off
Events: AUTO_EVALUATE, MANUAL_OVERRIDE, TEMPERATURE_CHANGE
Context: { indoorTemp, outdoorTemp, systemMode, currentHour, isWeekday }
```

### Key Components to Migrate
1. **HVACStateMachine** - Core state machine logic
2. **State definitions** - idle, evaluating, heating, cooling, off
3. **Context management** - Temperature readings, system configuration
4. **Event handling** - Auto evaluation, manual overrides, sensor updates
5. **Guards/Conditions** - Temperature thresholds, time-based logic
6. **Actions** - HVAC entity control, logging, notifications

## Migration Strategy

### Phase 1: Foundation Setup (Week 1-2)
**Goal**: Establish LangGraph infrastructure alongside existing XState

#### 1.1 Dependencies
```json
// Add to deno.json
{
  "imports": {
    "@langchain/core": "npm:@langchain/core@^0.3.61",
    "@langchain/langgraph": "npm:@langchain/langgraph@^0.0.26",
    "langchain": "npm:langchain@^0.3.29"
  }
}
```

#### 1.2 Directory Structure
```
src/
├── hvac/
│   ├── state-machine.ts           # Keep existing XState
│   ├── state-machine-lg.ts        # New LangGraph implementation
│   ├── lg-nodes/                  # LangGraph node functions
│   │   ├── evaluation-node.ts
│   │   ├── heating-node.ts
│   │   ├── cooling-node.ts
│   │   └── idle-node.ts
│   └── lg-types/                  # LangGraph type definitions
│       └── hvac-state.ts
```

#### 1.3 Feature Flag
```typescript
// Add to configuration
interface ApplicationOptions {
  // ... existing options
  useLangGraphStateMachine: boolean; // Default: false
}
```

### Phase 2: Core State Machine Translation (Week 3-4)
**Goal**: Implement equivalent LangGraph state machine

#### 2.1 State Definition
```typescript
// src/hvac/lg-types/hvac-state.ts
import { TypedDict } from "@langchain/core/dist/types";

interface HVACLangGraphState extends TypedDict {
  // Core state
  currentMode: "idle" | "evaluating" | "heating" | "cooling" | "off";
  
  // Context (same as XState)
  indoorTemp?: number;
  outdoorTemp?: number;
  systemMode: SystemMode;
  currentHour: number;
  isWeekday: boolean;
  lastDefrost?: Date;
  
  // Enhanced for LangGraph
  evaluationHistory: Array<{
    timestamp: Date;
    decision: string;
    reasoning: string;
    conditions: Record<string, unknown>;
  }>;
  
  // AI reasoning (future enhancement)
  aiRecommendations?: Array<{
    action: string;
    confidence: number;
    reasoning: string;
  }>;
}
```

#### 2.2 Node Implementation
```typescript
// src/hvac/lg-nodes/evaluation-node.ts
import { HVACLangGraphState } from "../lg-types/hvac-state.ts";

export async function evaluationNode(state: HVACLangGraphState): Promise<HVACLangGraphState> {
  const { indoorTemp, outdoorTemp, systemMode } = state;
  
  // Reuse existing evaluation logic from strategies
  const heatingStrategy = new HeatingStrategy(/* config */);
  const coolingStrategy = new CoolingStrategy(/* config */);
  
  let newMode: string;
  let reasoning: string;
  
  if (systemMode === SystemMode.OFF) {
    newMode = "off";
    reasoning = "System mode set to OFF";
  } else if (heatingStrategy.shouldHeat(/* conditions */)) {
    newMode = "heating";
    reasoning = `Heating needed: indoor ${indoorTemp}°C below target`;
  } else if (coolingStrategy.shouldCool(/* conditions */)) {
    newMode = "cooling"; 
    reasoning = `Cooling needed: indoor ${indoorTemp}°C above target`;
  } else {
    newMode = "idle";
    reasoning = "Temperature within acceptable range";
  }
  
  return {
    ...state,
    currentMode: newMode as any,
    evaluationHistory: [
      ...state.evaluationHistory,
      {
        timestamp: new Date(),
        decision: newMode,
        reasoning,
        conditions: { indoorTemp, outdoorTemp, systemMode }
      }
    ]
  };
}
```

#### 2.3 Graph Construction
```typescript
// src/hvac/state-machine-lg.ts
import { StateGraph } from "@langchain/langgraph";
import { HVACLangGraphState } from "./lg-types/hvac-state.ts";
import { evaluationNode } from "./lg-nodes/evaluation-node.ts";
import { heatingNode } from "./lg-nodes/heating-node.ts";
import { coolingNode } from "./lg-nodes/cooling-node.ts";
import { idleNode } from "./lg-nodes/idle-node.ts";

export class HVACLangGraphStateMachine {
  private graph: StateGraph<HVACLangGraphState>;
  
  constructor() {
    this.graph = new StateGraph<HVACLangGraphState>();
    this.buildGraph();
  }
  
  private buildGraph(): void {
    // Add nodes
    this.graph.addNode("evaluate", evaluationNode);
    this.graph.addNode("heating", heatingNode);
    this.graph.addNode("cooling", coolingNode);
    this.graph.addNode("idle", idleNode);
    
    // Add edges with routing logic
    this.graph.addConditionalEdges(
      "evaluate",
      this.routeFromEvaluation.bind(this),
      {
        "heating": "heating",
        "cooling": "cooling", 
        "idle": "idle",
        "off": "END"
      }
    );
    
    // Return to evaluation after action
    this.graph.addEdge("heating", "evaluate");
    this.graph.addEdge("cooling", "evaluate");
    this.graph.addEdge("idle", "evaluate");
    
    this.graph.setEntryPoint("evaluate");
  }
  
  private routeFromEvaluation(state: HVACLangGraphState): string {
    return state.currentMode;
  }
  
  async start(initialState: Partial<HVACLangGraphState>): Promise<void> {
    const app = this.graph.compile();
    
    const defaultState: HVACLangGraphState = {
      currentMode: "idle",
      systemMode: SystemMode.AUTO,
      currentHour: new Date().getHours(),
      isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
      evaluationHistory: [],
      ...initialState
    };
    
    // Stream execution for real-time monitoring
    const stream = await app.stream(defaultState);
    
    for await (const output of stream) {
      console.log("State update:", output);
    }
  }
}
```

### Phase 3: Integration & Testing (Week 5-6)
**Goal**: Integrate LangGraph state machine with existing controller

#### 3.1 Controller Abstraction
```typescript
// src/hvac/controller.ts - Modified
interface IHVACStateMachine {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCurrentState(): string;
  getStatus(): HVACStatus;
  manualOverride(mode: HVACMode, temperature?: number): Promise<void>;
  handleTemperatureChange(sensor: string, value: number): Promise<void>;
}

class HVACController {
  private stateMachine: IHVACStateMachine;
  
  constructor(
    private hvacOptions: HvacOptions,
    private appOptions: ApplicationOptions,
    // ... other dependencies
  ) {
    // Choose state machine implementation
    if (appOptions.useLangGraphStateMachine) {
      this.stateMachine = new HVACLangGraphStateMachine(/* ... */);
    } else {
      this.stateMachine = new HVACStateMachine(/* ... */);
    }
  }
}
```

#### 3.2 Testing Strategy
```typescript
// tests/unit/hvac/state-machine-lg.test.ts
Deno.test("LangGraph HVAC State Machine", async (t) => {
  await t.step("should initialize in idle state", async () => {
    const stateMachine = new HVACLangGraphStateMachine();
    const status = await stateMachine.getStatus();
    assertEquals(status.currentState, "idle");
  });
  
  await t.step("should transition to heating when cold", async () => {
    const stateMachine = new HVACLangGraphStateMachine();
    await stateMachine.handleTemperatureChange("indoor", 18.0);
    const status = await stateMachine.getStatus();
    assertEquals(status.currentState, "heating");
  });
  
  await t.step("should maintain evaluation history", async () => {
    const stateMachine = new HVACLangGraphStateMachine();
    await stateMachine.handleTemperatureChange("indoor", 26.0);
    const state = await stateMachine.getInternalState();
    assert(state.evaluationHistory.length > 0);
    assert(state.evaluationHistory[0].reasoning.includes("Cooling needed"));
  });
});
```

### Phase 4: AI Enhancement (Week 7-8)
**Goal**: Add AI-driven decision making capabilities

#### 4.1 AI Decision Node
```typescript
// src/hvac/lg-nodes/ai-advisor-node.ts
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

const AI_ADVISOR_PROMPT = PromptTemplate.fromTemplate(`
You are an HVAC optimization expert. Given the current conditions, provide recommendations:

Current State:
- Indoor Temperature: {indoorTemp}°C
- Outdoor Temperature: {outdoorTemp}°C  
- Current Mode: {currentMode}
- Time: {currentHour}:00 ({isWeekday ? "Weekday" : "Weekend"})
- Recent History: {recentHistory}

Consider:
1. Energy efficiency
2. Comfort optimization
3. System wear and tear
4. Time-of-day usage patterns

Provide your recommendation in JSON format:
{{
  "recommended_action": "heating|cooling|idle|off",
  "target_temperature": number,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "energy_optimization_tips": ["tip1", "tip2"]
}}
`);

export async function aiAdvisorNode(state: HVACLangGraphState): Promise<HVACLangGraphState> {
  if (!state.aiEnabled) {
    return state; // Skip AI if disabled
  }
  
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.1,
  });
  
  const prompt = await AI_ADVISOR_PROMPT.format({
    indoorTemp: state.indoorTemp,
    outdoorTemp: state.outdoorTemp,
    currentMode: state.currentMode,
    currentHour: state.currentHour,
    isWeekday: state.isWeekday,
    recentHistory: JSON.stringify(state.evaluationHistory.slice(-5))
  });
  
  const response = await llm.invoke(prompt);
  const aiRecommendation = JSON.parse(response.content as string);
  
  return {
    ...state,
    aiRecommendations: [
      ...(state.aiRecommendations || []),
      {
        action: aiRecommendation.recommended_action,
        confidence: aiRecommendation.confidence,
        reasoning: aiRecommendation.reasoning,
        timestamp: new Date(),
        energyTips: aiRecommendation.energy_optimization_tips
      }
    ]
  };
}
```

#### 4.2 Hybrid Decision Making
```typescript
// Enhanced evaluation node with AI integration
export async function hybridEvaluationNode(state: HVACLangGraphState): Promise<HVACLangGraphState> {
  // 1. Run traditional rule-based evaluation
  const ruleBasedResult = await evaluationNode(state);
  
  // 2. Get AI recommendation if enabled
  const aiEnhancedState = await aiAdvisorNode(ruleBasedResult);
  
  // 3. Combine decisions (safety-first approach)
  const finalDecision = combineDecisions(
    ruleBasedResult.currentMode,
    aiEnhancedState.aiRecommendations?.slice(-1)[0]
  );
  
  return {
    ...aiEnhancedState,
    currentMode: finalDecision,
    decisionMethod: aiEnhancedState.aiRecommendations ? "hybrid" : "rule_based"
  };
}

function combineDecisions(ruleDecision: string, aiRecommendation?: any): string {
  // Safety first: never override safety-critical decisions
  if (ruleDecision === "off") return "off";
  
  // Use AI recommendation if high confidence and not contradicting safety
  if (aiRecommendation?.confidence > 0.8) {
    return aiRecommendation.action;
  }
  
  return ruleDecision;
}
```

### Phase 5: Performance & Monitoring (Week 9-10)
**Goal**: Optimize performance and add comprehensive monitoring

#### 5.1 Performance Monitoring
```typescript
// src/hvac/lg-monitoring/performance-monitor.ts
export class LangGraphPerformanceMonitor {
  private metrics: Map<string, Array<number>> = new Map();
  
  startTimer(operation: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordMetric(operation, duration);
    };
  }
  
  recordMetric(operation: string, value: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(value);
  }
  
  getStats(operation: string) {
    const values = this.metrics.get(operation) || [];
    return {
      count: values.length,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }
}
```

#### 5.2 State Persistence
```typescript
// src/hvac/lg-persistence/state-store.ts
export class HVACStateStore {
  private stateFile = "./data/hvac-langgraph-state.json";
  
  async saveState(state: HVACLangGraphState): Promise<void> {
    await Deno.writeTextFile(this.stateFile, JSON.stringify(state, null, 2));
  }
  
  async loadState(): Promise<HVACLangGraphState | null> {
    try {
      const content = await Deno.readTextFile(this.stateFile);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
```

## Migration Milestones

### Week 1-2: Foundation ✅
- [ ] Add LangGraph dependencies
- [ ] Create directory structure
- [ ] Implement feature flag
- [ ] Basic type definitions

### Week 3-4: Core Implementation ✅
- [ ] Translate XState logic to LangGraph nodes
- [ ] Implement state routing
- [ ] Basic graph construction
- [ ] Unit tests for nodes

### Week 5-6: Integration ✅
- [ ] Controller abstraction
- [ ] Feature flag integration
- [ ] Comprehensive testing
- [ ] Performance benchmarking

### Week 7-8: AI Enhancement ✅
- [ ] AI advisor node
- [ ] Hybrid decision making
- [ ] Prompt engineering
- [ ] AI safety guards

### Week 9-10: Production Ready ✅
- [ ] Performance optimization
- [ ] State persistence
- [ ] Monitoring & logging
- [ ] Documentation

## Risk Assessment

### High Risk
1. **Performance**: LangGraph may be slower than XState for real-time control
2. **Complexity**: Added complexity may introduce bugs
3. **Dependencies**: LangChain ecosystem adds weight

### Medium Risk  
1. **Learning Curve**: Team needs to learn LangGraph concepts
2. **AI Reliability**: AI decisions may not always be optimal
3. **Debugging**: Graph-based debugging is different from XState

### Low Risk
1. **Rollback**: Feature flag allows instant rollback to XState
2. **Incremental**: Phase-by-phase approach minimizes risk

## Success Criteria

### Functional Requirements ✅
- [ ] All existing HVAC functionality preserved
- [ ] State transitions work identically to XState version
- [ ] Performance within 10% of XState implementation
- [ ] Zero regressions in existing features

### Enhancement Goals ✅
- [ ] AI recommendations improve energy efficiency by 5%
- [ ] Decision reasoning is logged and traceable
- [ ] Historical decision analysis capabilities
- [ ] Future extensibility for learning algorithms

## Rollback Plan

If migration proves problematic:
1. Set `useLangGraphStateMachine: false` in configuration
2. System automatically reverts to XState implementation
3. All existing functionality preserved
4. Remove LangGraph dependencies if desired

## Next Steps

1. Review and approve this migration plan
2. Begin Phase 1 implementation
3. Set up regular review meetings (weekly)
4. Create feature branch protection rules
5. Establish testing criteria for each phase

---

**Note**: This is an experimental migration. The existing XState implementation will be preserved throughout the experiment, ensuring system reliability is never compromised.