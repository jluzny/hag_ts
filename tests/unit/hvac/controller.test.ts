/**
 * Unit tests for HVAC controller in HAG JavaScript variant.
 * 
 * Tests controller lifecycle, state management, and HVAC operations.
 */

import { assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { HVACController } from '../../../src/hvac/controller.ts';
import { HVACStateMachine } from '../../../src/hvac/state-machine.ts';
import { HvacOptions, ApplicationOptions } from '../../../src/config/settings.ts';
import { HVACMode, HVACStatus, OperationResult, SystemMode, LogLevel } from '../../../src/types/common.ts';
import { StateError, HVACOperationError } from '../../../src/core/exceptions.ts';

// Mock logger service
class MockLoggerService {
  info(message: string, _data?: Record<string, unknown>): void {
    // console.log(`INFO: ${message}`);
  }

  error(message: string, _error?: unknown): void {
    // console.log(`ERROR: ${message}`);
  }

  debug(message: string, _data?: Record<string, unknown>): void {
    // console.log(`DEBUG: ${message}`);
  }

  warning(message: string, _data?: Record<string, unknown>): void {
    // console.log(`WARNING: ${message}`);
  }
}

// Mock Home Assistant client
class MockHomeAssistantClient {
  private _connected = false;
  private mockStates = new Map<string, { state: string; attributes: Record<string, unknown> }>();
  private eventHandlers = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    // Set up mock sensor states
    this.mockStates.set('sensor.indoor_temp', {
      state: '21.5',
      attributes: { unit_of_measurement: '°C' },
    });
    this.mockStates.set('sensor.outdoor_temp', {
      state: '15.0',
      attributes: { unit_of_measurement: '°C' },
    });
  }

  connect(): Promise<void> {
    this._connected = true;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this._connected = false;
    return Promise.resolve();
  }

  get connected(): boolean {
    return this._connected;
  }

  async getState(entityId: string) {
    const mockState = this.mockStates.get(entityId);
    if (!mockState) {
      throw new Error(`Entity ${entityId} not found`);
    }
    
    return {
      entityId,
      state: mockState.state,
      attributes: mockState.attributes,
      getNumericState: () => parseFloat(mockState.state),
    };
  }

  callService(_serviceCall: unknown): Promise<void> {
    return Promise.resolve();
  }

  subscribeEvents(_eventType: string): Promise<void> {
    return Promise.resolve();
  }

  addEventHandler(eventType: string, handler: (event: unknown) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  removeEventHandler(_eventType: string, _handler: (event: unknown) => void): void {
    // Mock implementation
  }

  setMockState(entityId: string, state: string, attributes: Record<string, unknown> = {}): void {
    this.mockStates.set(entityId, { state, attributes });
  }

  triggerMockEvent(eventType: string, eventData: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => handler(eventData));
    }
  }
}

// Mock state machine
class MockHVACStateMachine {
  private currentState = 'idle';
  private context = {
    indoorTemp: 21.5,
    outdoorTemp: 15.0,
    systemMode: SystemMode.AUTO,
  };

  start(): void {
    // Mock start
  }

  stop(): void {
    // Mock stop
  }

  getCurrentState(): string {
    return this.currentState;
  }

  getStatus() {
    return {
      currentState: this.currentState,
      context: this.context,
    };
  }

  updateTemperatures(indoor: number, outdoor: number): void {
    this.context.indoorTemp = indoor;
    this.context.outdoorTemp = outdoor;
  }

  evaluateConditions(): void {
    // Mock evaluation - simple logic for testing
    if (this.context.indoorTemp < 19.0) {
      this.currentState = 'heating';
    } else if (this.context.indoorTemp > 26.0) {
      this.currentState = 'cooling';
    } else {
      this.currentState = 'idle';
    }
  }

  manualOverride(mode: HVACMode, _temperature?: number): void {
    this.currentState = 'manualOverride';
  }

  triggerDefrost(): void {
    this.currentState = 'defrosting';
  }
}

// Test configuration
const mockHvacOptions: HvacOptions = {
  tempSensor: 'sensor.indoor_temp',
  outdoorSensor: 'sensor.outdoor_temp',
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    {
      entityId: 'climate.test_hvac',
      enabled: true,
      defrost: false,
    },
  ],
  heating: {
    temperature: 21.0,
    presetMode: 'comfort',
    temperatureThresholds: {
      indoorMin: 19.0,
      indoorMax: 22.0,
      outdoorMin: -10.0,
      outdoorMax: 15.0,
    },
  },
  cooling: {
    temperature: 24.0,
    presetMode: 'eco',
    temperatureThresholds: {
      indoorMin: 23.0,
      indoorMax: 26.0,
      outdoorMin: 10.0,
      outdoorMax: 45.0,
    },
  },
};

const mockAppOptions: ApplicationOptions = {
  logLevel: LogLevel.ERROR,
  useAi: false,
  aiModel: 'gpt-4o-mini',
  aiTemperature: 0.1,
  openaiApiKey: undefined,
};

Deno.test('HVAC Controller - Initialization and Lifecycle', async (t) => {
  let controller: HVACController;
  let mockStateMachine: MockHVACStateMachine;
  let mockHaClient: MockHomeAssistantClient;
  let mockLogger: MockLoggerService;

  await t.step('should initialize with dependencies', () => {
    mockStateMachine = new MockHVACStateMachine();
    mockHaClient = new MockHomeAssistantClient();
    mockLogger = new MockLoggerService();

    controller = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    assertExists(controller);
  });

  await t.step('should start successfully', async () => {
    await controller.start();
    
    // Verify state
    const status = await controller.getStatus();
    assertEquals(status.controller.running, true);
    assertEquals(status.controller.haConnected, true);
  });

  await t.step('should not start if already running', async () => {
    // Try to start again
    await controller.start(); // Should handle gracefully
    
    const status = await controller.getStatus();
    assertEquals(status.controller.running, true);
  });

  await t.step('should stop successfully', async () => {
    await controller.stop();
    
    const status = await controller.getStatus();
    assertEquals(status.controller.running, false);
  });

  await t.step('should handle start failure', async () => {
    // Create controller with failing HA client
    const failingHaClient = {
      connect: () => Promise.reject(new Error('Connection failed')),
      disconnect: () => Promise.resolve(),
      connected: false,
    };

    const failingController = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      failingHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    await assertRejects(
      () => failingController.start(),
      StateError,
      'Failed to start HVAC controller'
    );
  });
});

Deno.test('HVAC Controller - Status and Monitoring', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  const controller = new HVACController(
    mockHvacOptions,
    mockAppOptions,
    mockStateMachine as unknown as HVACStateMachine,
    mockHaClient as unknown as any,
    mockLogger as unknown as any,
  );

  await t.step('should provide status when stopped', async () => {
    const status = await controller.getStatus();
    
    assertExists(status);
    assertEquals(status.controller.running, false);
    assertEquals(status.controller.haConnected, false);
    assertEquals(status.controller.tempSensor, mockHvacOptions.tempSensor);
    assertEquals(status.controller.systemMode, mockHvacOptions.systemMode);
    assertEquals(status.controller.aiEnabled, false);
    assertExists(status.stateMachine);
    assertExists(status.timestamp);
  });

  await t.step('should provide status when running', async () => {
    await controller.start();
    const status = await controller.getStatus();
    
    assertEquals(status.controller.running, true);
    assertEquals(status.controller.haConnected, true);
    assertEquals(status.stateMachine.currentState, 'idle');
    assertExists(status.stateMachine.conditions);
  });

  await t.step('should handle status errors gracefully', async () => {
    // Create controller with failing dependencies
    const failingStateMachine = {
      getStatus: () => { throw new Error('State machine error'); },
      start: () => {},
      stop: () => {},
    };

    const errorController = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      failingStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    const status = await errorController.getStatus();
    
    // Should return error status
    assertEquals(status.controller.running, false);
    assertEquals(status.stateMachine.currentState, 'error');
  });

  await controller.stop();
});

Deno.test('HVAC Controller - Manual Operations', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  const controller = new HVACController(
    mockHvacOptions,
    mockAppOptions,
    mockStateMachine as unknown as HVACStateMachine,
    mockHaClient as unknown as any,
    mockLogger as unknown as any,
  );

  await controller.start();

  await t.step('should trigger manual evaluation', async () => {
    const result = await controller.triggerEvaluation();
    
    assertEquals(result.success, true);
    assertExists(result.timestamp);
  });

  await t.step('should handle manual override - heat', async () => {
    const result = await controller.manualOverride('heat', { temperature: 22.0 });
    
    assertEquals(result.success, true);
    assertExists(result.data);
    assertExists(result.timestamp);
  });

  await t.step('should handle manual override - cool', async () => {
    const result = await controller.manualOverride('cool', { temperature: 24.0 });
    
    assertEquals(result.success, true);
    assertExists(result.data);
  });

  await t.step('should handle manual override - off', async () => {
    const result = await controller.manualOverride('off');
    
    assertEquals(result.success, true);
    assertExists(result.data);
  });

  await t.step('should reject invalid manual override action', async () => {
    await assertRejects(
      () => controller.manualOverride('invalid_action'),
      HVACOperationError,
    );
  });

  await t.step('should reject operations when not running', async () => {
    await controller.stop();
    
    await assertRejects(
      () => controller.triggerEvaluation(),
      StateError,
      'HVAC controller is not running'
    );

    await assertRejects(
      () => controller.manualOverride('heat'),
      StateError,
      'HVAC controller is not running'
    );
  });

  await controller.stop();
});

Deno.test('HVAC Controller - Efficiency Evaluation', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  const controller = new HVACController(
    mockHvacOptions,
    mockAppOptions,
    mockStateMachine as unknown as HVACStateMachine,
    mockHaClient as unknown as any,
    mockLogger as unknown as any,
  );

  await controller.start();

  await t.step('should evaluate efficiency without AI', async () => {
    const result = await controller.evaluateEfficiency();
    
    assertEquals(result.success, true);
    assertExists(result.data);
    assertExists(result.timestamp);
    
    // Should contain basic analysis
    const data = result.data as any;
    assertExists(data.analysis);
    assertExists(data.recommendations);
  });

  await t.step('should handle efficiency evaluation when not running', async () => {
    await controller.stop();
    
    await assertRejects(
      () => controller.evaluateEfficiency(),
      StateError,
      'HVAC controller is not running'
    );
  });

  await controller.stop();
});

Deno.test('HVAC Controller - Temperature Change Handling', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  const controller = new HVACController(
    mockHvacOptions,
    mockAppOptions,
    mockStateMachine as unknown as HVACStateMachine,
    mockHaClient as unknown as any,
    mockLogger as unknown as any,
  );

  await controller.start();

  await t.step('should handle temperature sensor changes', async () => {
    // Set up mock temperature values
    mockHaClient.setMockState('sensor.indoor_temp', '18.5');
    mockHaClient.setMockState('sensor.outdoor_temp', '5.0');

    // Simulate state change event
    const mockEvent = {
      eventType: 'state_changed',
      isStateChanged: () => true,
      getStateChangeData: () => ({
        entityId: 'sensor.indoor_temp',
        newState: { state: '18.5', attributes: {} },
        oldState: { state: '21.5', attributes: {} },
      }),
      timeFired: new Date(),
    };

    // Trigger event handler
    mockHaClient.triggerMockEvent('state_changed', mockEvent);

    // Give some time for async processing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify state machine was updated
    const status = await controller.getStatus();
    assertExists(status);
  });

  await t.step('should ignore non-temperature sensor changes', async () => {
    const mockEvent = {
      eventType: 'state_changed',
      isStateChanged: () => true,
      getStateChangeData: () => ({
        entityId: 'sensor.other_sensor',
        newState: { state: 'on', attributes: {} },
        oldState: { state: 'off', attributes: {} },
      }),
      timeFired: new Date(),
    };

    // Should handle gracefully
    mockHaClient.triggerMockEvent('state_changed', mockEvent);
    
    // Should not affect controller
    const status = await controller.getStatus();
    assertExists(status);
  });

  await t.step('should handle invalid temperature values', async () => {
    const mockEvent = {
      eventType: 'state_changed',
      isStateChanged: () => true,
      getStateChangeData: () => ({
        entityId: 'sensor.indoor_temp',
        newState: { state: 'invalid', attributes: {} },
        oldState: { state: '21.5', attributes: {} },
      }),
      timeFired: new Date(),
    };

    // Should handle gracefully without throwing
    mockHaClient.triggerMockEvent('state_changed', mockEvent);
    
    const status = await controller.getStatus();
    assertExists(status);
  });

  await controller.stop();
});

Deno.test('HVAC Controller - Error Handling', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  await t.step('should handle state machine errors', async () => {
    const failingStateMachine = {
      start: () => { throw new Error('State machine start failed'); },
      stop: () => {},
      getCurrentState: () => 'error',
      getStatus: () => ({ currentState: 'error', context: {} }),
    };

    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      failingStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    await assertRejects(
      () => controller.start(),
      StateError,
    );
  });

  await t.step('should handle Home Assistant connection errors', async () => {
    const failingHaClient = {
      connect: () => Promise.reject(new Error('HA connection failed')),
      disconnect: () => Promise.resolve(),
      connected: false,
    };

    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      failingHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    await assertRejects(
      () => controller.start(),
      StateError,
    );
  });

  await t.step('should handle evaluation errors gracefully', async () => {
    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
    );

    await controller.start();

    // Mock an error in evaluation
    const originalGetState = mockHaClient.getState;
    mockHaClient.getState = () => Promise.reject(new Error('Sensor error'));

    const result = await controller.triggerEvaluation();
    assertEquals(result.success, false);
    assertExists(result.error);

    // Restore original method
    mockHaClient.getState = originalGetState;
    await controller.stop();
  });
});

Deno.test('HVAC Controller - HVAC Mode Parsing', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  const controller = new HVACController(
    mockHvacOptions,
    mockAppOptions,
    mockStateMachine as unknown as HVACStateMachine,
    mockHaClient as unknown as any,
    mockLogger as unknown as any,
  );

  await controller.start();

  await t.step('should parse valid HVAC modes', async () => {
    const validModes = ['heat', 'cool', 'off'];
    
    for (const mode of validModes) {
      const result = await controller.manualOverride(mode);
      assertEquals(result.success, true);
    }
  });

  await t.step('should handle case insensitive modes', async () => {
    const modes = ['HEAT', 'Cool', 'OFF'];
    
    for (const mode of modes) {
      const result = await controller.manualOverride(mode);
      assertEquals(result.success, true);
    }
  });

  await controller.stop();
});

Deno.test('HVAC Controller - AI Integration', async (t) => {
  const mockStateMachine = new MockHVACStateMachine();
  const mockHaClient = new MockHomeAssistantClient();
  const mockLogger = new MockLoggerService();

  // Mock AI agent
  const mockAIAgent = {
    getStatusSummary: () => Promise.resolve({
      success: true,
      aiSummary: 'System operating normally',
      recommendations: ['Maintain current schedule'],
    }),
    processTemperatureChange: () => Promise.resolve(),
    manualOverride: (action: string, options: Record<string, unknown>) => Promise.resolve({
      success: true,
      action,
      options,
    }),
    evaluateEfficiency: () => Promise.resolve({
      success: true,
      analysis: 'Efficiency is optimal',
      recommendations: ['Continue current settings'],
    }),
  };

  const aiAppOptions: ApplicationOptions = {
    ...mockAppOptions,
    useAi: true,
  };

  await t.step('should integrate with AI agent for status', async () => {
    const controller = new HVACController(
      mockHvacOptions,
      aiAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
      mockAIAgent,
    );

    await controller.start();
    const status = await controller.getStatus();
    
    assertEquals(status.controller.aiEnabled, true);
    assertExists(status.aiAnalysis);
    
    await controller.stop();
  });

  await t.step('should use AI agent for manual override', async () => {
    const controller = new HVACController(
      mockHvacOptions,
      aiAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
      mockAIAgent,
    );

    await controller.start();
    const result = await controller.manualOverride('heat', { temperature: 22.0 });
    
    assertEquals(result.success, true);
    assertExists(result.data);
    
    await controller.stop();
  });

  await t.step('should use AI agent for efficiency evaluation', async () => {
    const controller = new HVACController(
      mockHvacOptions,
      aiAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as any,
      mockLogger as unknown as any,
      mockAIAgent,
    );

    await controller.start();
    const result = await controller.evaluateEfficiency();
    
    assertEquals(result.success, true);
    assertExists(result.data);
    
    await controller.stop();
  });
});