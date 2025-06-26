/**
 * Unit tests for common types in HAG JavaScript variant.
 */

import { assertEquals, assertInstanceOf } from '@std/assert';
import { 
  HVACMode, 
  SystemMode, 
  LogLevel, 
  WebSocketState,
  type HVACStatus,
  type OperationResult,
  type ConnectionStats,
} from '../../../src/types/common.ts';

Deno.test('HVACMode enum', async (t) => {
  await t.step('should have correct HVAC mode values', () => {
    assertEquals(HVACMode.HEAT, 'heat');
    assertEquals(HVACMode.COOL, 'cool');
    assertEquals(HVACMode.OFF, 'off');
    assertEquals(HVACMode.AUTO, 'auto');
  });

  await t.step('should have all expected modes', () => {
    const modes = Object.values(HVACMode);
    assertEquals(modes.length, 4);
    assertEquals(modes.includes('heat'), true);
    assertEquals(modes.includes('cool'), true);
    assertEquals(modes.includes('off'), true);
    assertEquals(modes.includes('auto'), true);
  });
});

Deno.test('SystemMode enum', async (t) => {
  await t.step('should have correct system mode values', () => {
    assertEquals(SystemMode.AUTO, 'auto');
    assertEquals(SystemMode.HEAT_ONLY, 'heat_only');
    assertEquals(SystemMode.COOL_ONLY, 'cool_only');
    assertEquals(SystemMode.OFF, 'off');
  });

  await t.step('should have all expected system modes', () => {
    const modes = Object.values(SystemMode);
    assertEquals(modes.length, 4);
    assertEquals(modes.includes('auto'), true);
    assertEquals(modes.includes('heat_only'), true);
    assertEquals(modes.includes('cool_only'), true);
    assertEquals(modes.includes('off'), true);
  });
});

Deno.test('LogLevel enum', async (t) => {
  await t.step('should have correct log level values', () => {
    assertEquals(LogLevel.DEBUG, 'debug');
    assertEquals(LogLevel.INFO, 'info');
    assertEquals(LogLevel.WARNING, 'warning');
    assertEquals(LogLevel.ERROR, 'error');
  });

  await t.step('should have hierarchical ordering', () => {
    const levels = Object.values(LogLevel);
    assertEquals(levels.length, 4);
    
    // Should be in order of verbosity
    assertEquals(levels[0], 'debug');
    assertEquals(levels[1], 'info');
    assertEquals(levels[2], 'warning');
    assertEquals(levels[3], 'error');
  });
});

Deno.test('WebSocketState enum', async (t) => {
  await t.step('should have correct WebSocket state values', () => {
    assertEquals(WebSocketState.CONNECTING, 'connecting');
    assertEquals(WebSocketState.CONNECTED, 'connected');
    assertEquals(WebSocketState.DISCONNECTED, 'disconnected');
    assertEquals(WebSocketState.RECONNECTING, 'reconnecting');
    assertEquals(WebSocketState.AUTHENTICATING, 'authenticating');
    assertEquals(WebSocketState.ERROR, 'error');
  });

  await t.step('should have all connection states', () => {
    const states = Object.values(WebSocketState);
    assertEquals(states.length, 6);
    assertEquals(states.includes('connecting'), true);
    assertEquals(states.includes('connected'), true);
    assertEquals(states.includes('disconnected'), true);
    assertEquals(states.includes('reconnecting'), true);
    assertEquals(states.includes('authenticating'), true);
    assertEquals(states.includes('error'), true);
  });
});

Deno.test('HVACStatus type structure', async (t) => {
  await t.step('should accept valid HVAC status object', () => {
    const status: HVACStatus = {
      controller: {
        running: true,
        haConnected: true,
        tempSensor: 'sensor.indoor_temperature',
        systemMode: SystemMode.AUTO,
        aiEnabled: false,
      },
      stateMachine: {
        currentState: 'idle',
        hvacMode: HVACMode.OFF,
        conditions: {
          indoorTemp: 22.5,
          outdoorTemp: 15.0,
        },
      },
      timestamp: new Date().toISOString(),
    };

    // Verify the structure is valid
    assertEquals(status.controller.running, true);
    assertEquals(status.controller.haConnected, true);
    assertEquals(status.controller.systemMode, SystemMode.AUTO);
    assertEquals(status.stateMachine.currentState, 'idle');
    assertEquals(status.stateMachine.hvacMode, HVACMode.OFF);
    assertEquals(typeof status.timestamp, 'string');
  });

  await t.step('should accept optional AI analysis', () => {
    const statusWithAI: HVACStatus = {
      controller: {
        running: true,
        haConnected: true,
        tempSensor: 'sensor.temp',
        systemMode: SystemMode.AUTO,
        aiEnabled: true,
      },
      stateMachine: {
        currentState: 'heating',
      },
      timestamp: new Date().toISOString(),
      aiAnalysis: 'System is efficiently maintaining target temperature.',
    };

    assertEquals(statusWithAI.aiAnalysis, 'System is efficiently maintaining target temperature.');
    assertEquals(statusWithAI.controller.aiEnabled, true);
  });
});

Deno.test('OperationResult type structure', async (t) => {
  await t.step('should accept successful operation result', () => {
    const successResult: OperationResult = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        action: 'heat',
        temperature: 21.0,
      },
    };

    assertEquals(successResult.success, true);
    assertEquals(typeof successResult.timestamp, 'string');
    assertEquals(successResult.data?.action, 'heat');
    assertEquals(successResult.error, undefined);
  });

  await t.step('should accept failed operation result', () => {
    const failureResult: OperationResult = {
      success: false,
      timestamp: new Date().toISOString(),
      error: 'HVAC system not responding',
    };

    assertEquals(failureResult.success, false);
    assertEquals(failureResult.error, 'HVAC system not responding');
    assertEquals(failureResult.data, undefined);
  });

  await t.step('should accept result with both data and error', () => {
    const partialResult: OperationResult = {
      success: false,
      timestamp: new Date().toISOString(),
      error: 'Partial failure',
      data: {
        attemptedAction: 'cool',
        entitiesProcessed: 2,
        entitiesFailed: 1,
      },
    };

    assertEquals(partialResult.success, false);
    assertEquals(partialResult.error, 'Partial failure');
    assertEquals(partialResult.data?.entitiesProcessed, 2);
  });
});

Deno.test('ConnectionStats type structure', async (t) => {
  await t.step('should accept valid connection statistics', () => {
    const stats: ConnectionStats = {
      totalConnections: 5,
      totalReconnections: 2,
      totalMessages: 1250,
      totalErrors: 3,
      lastConnected: new Date(),
      lastError: new Date(),
    };

    assertEquals(stats.totalConnections, 5);
    assertEquals(stats.totalReconnections, 2);
    assertEquals(stats.totalMessages, 1250);
    assertEquals(stats.totalErrors, 3);
    assertInstanceOf(stats.lastConnected, Date);
    assertInstanceOf(stats.lastError, Date);
  });

  await t.step('should accept minimal connection statistics', () => {
    const minimalStats: ConnectionStats = {
      totalConnections: 1,
      totalReconnections: 0,
      totalMessages: 50,
      totalErrors: 0,
    };

    assertEquals(minimalStats.totalConnections, 1);
    assertEquals(minimalStats.totalReconnections, 0);
    assertEquals(minimalStats.totalMessages, 50);
    assertEquals(minimalStats.totalErrors, 0);
    assertEquals(minimalStats.lastConnected, undefined);
    assertEquals(minimalStats.lastError, undefined);
  });
});

Deno.test('Type compatibility and relationships', async (t) => {
  await t.step('should allow HVACMode values in status', () => {
    const status: HVACStatus = {
      controller: {
        running: true,
        haConnected: true,
        tempSensor: 'sensor.temp',
        systemMode: SystemMode.HEAT_ONLY,
        aiEnabled: false,
      },
      stateMachine: {
        currentState: 'heating',
        hvacMode: HVACMode.HEAT, // Should accept HVACMode enum
      },
      timestamp: new Date().toISOString(),
    };

    assertEquals(status.stateMachine.hvacMode, HVACMode.HEAT);
    assertEquals(status.controller.systemMode, SystemMode.HEAT_ONLY);
  });

  await t.step('should allow WebSocketState values in connection status', () => {
    // This would be used in connection status tracking
    const connectionState = WebSocketState.CONNECTED;
    assertEquals(connectionState, 'connected');
    
    const errorState = WebSocketState.ERROR;
    assertEquals(errorState, 'error');
  });
});

Deno.test('Type guards and validation helpers', async (t) => {
  await t.step('should validate operation result structure', () => {
    const validResult = {
      success: true,
      timestamp: new Date().toISOString(),
    };

    // Check that required fields are present
    assertEquals(typeof validResult.success, 'boolean');
    assertEquals(typeof validResult.timestamp, 'string');
  });

  await t.step('should validate HVAC status structure', () => {
    const validStatus = {
      controller: {
        running: true,
        haConnected: false,
        tempSensor: 'sensor.temp',
        systemMode: 'auto',
        aiEnabled: false,
      },
      stateMachine: {
        currentState: 'idle',
      },
      timestamp: new Date().toISOString(),
    };

    // Check that required nested structures are present
    assertEquals(typeof validStatus.controller, 'object');
    assertEquals(typeof validStatus.stateMachine, 'object');
    assertEquals(typeof validStatus.controller.running, 'boolean');
    assertEquals(typeof validStatus.stateMachine.currentState, 'string');
  });
});