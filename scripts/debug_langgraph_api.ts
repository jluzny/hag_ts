#!/usr/bin/env -S deno run --allow-all
/**
 * Debug script to understand LangGraph StateGraph API
 */

import { StateGraph } from "@langchain/langgraph";

console.log("🔍 Testing LangGraph StateGraph API...");

try {
  // Test 1: Empty constructor
  console.log("Test 1: Empty constructor");
  try {
    new StateGraph({});
    console.log("✅ Empty object works");
  } catch (error) {
    console.log(
      "❌ Empty object failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // Test 2: Object with annotation (skipped - requires proper types)
  console.log("\nTest 2: Object with annotation - SKIPPED");
  console.log("⚠️ annotation property requires proper type definitions");

  // Test 3: Different state schema format (skipped - requires proper types)
  console.log("\nTest 3: Different state schema format - SKIPPED");
  console.log("⚠️ channels property requires proper type definitions");

  // Test 4: Simple interface approach (skipped - requires proper channels argument)
  console.log("\nTest 4: Simple interface - SKIPPED");
  console.log("⚠️ TypeScript interface requires channels argument");
} catch (error) {
  console.error("❌ Failed to test LangGraph API:", error);
}
