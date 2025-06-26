/**
 * Unit tests for core exceptions in HAG JavaScript variant.
 */

import { assertEquals, assertInstanceOf } from '@std/assert';
import { 
  HAGError, 
  StateError, 
  ConfigurationError, 
  ConnectionError, 
  ValidationError, 
  HVACOperationError,
  AIError,
  isHAGError,
  extractErrorDetails
} from '../../../src/core/exceptions.ts';

Deno.test('HAGError', async (t) => {
  await t.step('should create basic HAG error', () => {
    const error = new HAGError('Test error');
    assertEquals(error.message, 'Test error');
    assertEquals(error.name, 'HAGError');
    assertEquals(error.code, undefined);
  });

  await t.step('should create HAG error with code and cause', () => {
    const cause = new Error('Root cause');
    const error = new HAGError('Test error', 'TEST_CODE', cause);
    assertEquals(error.message, 'Test error');
    assertEquals(error.code, 'TEST_CODE');
    assertEquals(error.cause, cause);
  });
});

Deno.test('StateError', async (t) => {
  await t.step('should create state error with entity info', () => {
    const error = new StateError('Entity not found', 'idle', 'sensor.temp');
    assertEquals(error.message, 'Entity not found');
    assertEquals(error.state, 'idle');
    assertEquals(error.entityId, 'sensor.temp');
    assertEquals(error.code, 'STATE_ERROR');
  });

  await t.step('should inherit from HAGError', () => {
    const error = new StateError('Test');
    assertInstanceOf(error, HAGError);
    assertInstanceOf(error, StateError);
  });
});

Deno.test('ConfigurationError', async (t) => {
  await t.step('should create configuration error with field info', () => {
    const error = new ConfigurationError('Invalid value', 'temperature', 50);
    assertEquals(error.message, 'Invalid value');
    assertEquals(error.field, 'temperature');
    assertEquals(error.value, 50);
    assertEquals(error.code, 'CONFIG_ERROR');
  });
});

Deno.test('ConnectionError', async (t) => {
  await t.step('should create connection error with endpoint info', () => {
    const error = new ConnectionError('Connection failed', 'ws://localhost:8123', 3);
    assertEquals(error.message, 'Connection failed');
    assertEquals(error.endpoint, 'ws://localhost:8123');
    assertEquals(error.retryAttempt, 3);
    assertEquals(error.code, 'CONNECTION_ERROR');
  });
});

Deno.test('ValidationError', async (t) => {
  await t.step('should create validation error with type info', () => {
    const error = new ValidationError('Type mismatch', 'mode', 'string', 42);
    assertEquals(error.message, 'Type mismatch');
    assertEquals(error.field, 'mode');
    assertEquals(error.expectedType, 'string');
    assertEquals(error.actualValue, 42);
    assertEquals(error.code, 'VALIDATION_ERROR');
  });
});

Deno.test('HVACOperationError', async (t) => {
  await t.step('should create HVAC operation error', () => {
    const error = new HVACOperationError('Failed to heat', 'heat', 'climate.ac');
    assertEquals(error.message, 'Failed to heat');
    assertEquals(error.operation, 'heat');
    assertEquals(error.entityId, 'climate.ac');
    assertEquals(error.code, 'HVAC_OPERATION_ERROR');
  });
});

Deno.test('AIError', async (t) => {
  await t.step('should create AI error with model info', () => {
    const error = new AIError('Model failed', 'gpt-4o-mini', 'temperature_analysis');
    assertEquals(error.message, 'Model failed');
    assertEquals(error.model, 'gpt-4o-mini');
    assertEquals(error.context, 'temperature_analysis');
    assertEquals(error.code, 'AI_ERROR');
  });
});

Deno.test('isHAGError utility', async (t) => {
  await t.step('should identify HAG errors correctly', () => {
    const hagError = new HAGError('Test');
    const stateError = new StateError('Test');
    const regularError = new Error('Test');
    const notError = { message: 'Test' };

    assertEquals(isHAGError(hagError), true);
    assertEquals(isHAGError(stateError), true);
    assertEquals(isHAGError(regularError), false);
    assertEquals(isHAGError(notError), false);
  });
});

Deno.test('extractErrorDetails utility', async (t) => {
  await t.step('should extract HAG error details', () => {
    const error = new StateError('Entity not found', 'idle', 'sensor.temp');
    const details = extractErrorDetails(error);
    
    assertEquals(details.message, 'Entity not found');
    assertEquals(details.name, 'StateError');
    assertEquals(details.code, 'STATE_ERROR');
    assertEquals(typeof details.stack, 'string');
  });

  await t.step('should extract regular error details', () => {
    const error = new Error('Regular error');
    const details = extractErrorDetails(error);
    
    assertEquals(details.message, 'Regular error');
    assertEquals(details.name, 'Error');
    assertEquals(details.code, undefined);
    assertEquals(typeof details.stack, 'string');
  });

  await t.step('should handle non-error values', () => {
    const details = extractErrorDetails('String error');
    
    assertEquals(details.message, 'String error');
    assertEquals(details.name, 'UnknownError');
    assertEquals(details.code, undefined);
    assertEquals(details.stack, undefined);
  });
});