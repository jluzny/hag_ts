/**
 * Basic Test to Verify Test Infrastructure
 */

import { assertEquals, assertExists } from '@std/assert';

Deno.test({
  name: 'Basic Test Infrastructure - Math Operations',
  fn: () => {
    assertEquals(2 + 2, 4);
    assertEquals(10 * 5, 50);
    console.log('✅ Basic math operations working');
  }
});

Deno.test({
  name: 'Basic Test Infrastructure - Object Creation',
  fn: () => {
    const testObject = {
      name: 'HAG Test',
      version: '1.0.0',
      features: ['AI', 'Learning', 'Optimization']
    };
    
    assertExists(testObject);
    assertEquals(testObject.name, 'HAG Test');
    assertEquals(testObject.features.length, 3);
    
    console.log('✅ Object creation and validation working');
  }
});

Deno.test({
  name: 'Basic Test Infrastructure - Async Operations',
  fn: async () => {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    const start = performance.now();
    await delay(10);
    const end = performance.now();
    
    assertEquals(end > start, true);
    console.log('✅ Async operations working');
  }
});

console.log('🎉 Basic test infrastructure verified!');