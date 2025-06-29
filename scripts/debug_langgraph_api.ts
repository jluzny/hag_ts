#!/usr/bin/env -S deno run --allow-all
/**
 * Debug script to understand LangGraph StateGraph API
 */

import { StateGraph } from '@langchain/langgraph';

console.log('🔍 Testing LangGraph StateGraph API...');

try {
  // Test 1: Empty constructor
  console.log('Test 1: Empty constructor');
  try {
    const graph1 = new StateGraph({});
    console.log('✅ Empty object works');
  } catch (error) {
    console.log('❌ Empty object failed:', error.message);
  }

  // Test 2: Object with annotation
  console.log('\nTest 2: Object with annotation');
  try {
    const graph2 = new StateGraph({ annotation: {} });
    console.log('✅ annotation property works');
  } catch (error) {
    console.log('❌ annotation property failed:', error.message);
  }

  // Test 3: Different state schema format
  console.log('\nTest 3: Different state schema format');
  try {
    const graph3 = new StateGraph({
      channels: {
        currentMode: {
          value: (x: string, y: string) => y || x,
          default: () => 'idle',
        },
      },
    });
    console.log('✅ channels property works');
  } catch (error) {
    console.log('❌ channels property failed:', error.message);
  }

  // Test 4: Simple interface approach
  console.log('\nTest 4: Simple interface');
  try {
    interface TestState {
      currentMode: string;
      temperature: number;
    }
    const graph4 = new StateGraph<TestState>({});
    console.log('✅ TypeScript interface works');
  } catch (error) {
    console.log('❌ TypeScript interface failed:', error.message);
  }
} catch (error) {
  console.error('❌ Failed to test LangGraph API:', error);
}
