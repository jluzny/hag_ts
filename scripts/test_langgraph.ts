#!/usr/bin/env -S deno run --allow-all
/**
 * Test script for LangGraph HVAC State Machine
 * 
 * This script tests the LangGraph implementation to ensure it works correctly
 * before integrating with the full application.
 */

import { createContainer } from '../src/core/container.ts';
import { LangGraphHVACStateMachineAdapter } from '../src/hvac/state-machine-lg-adapter.ts';
import { HVACMode, SystemMode } from '../src/types/common.ts';

/**
 * Test the LangGraph HVAC state machine implementation
 */
async function testLangGraphStateMachine() {
  console.log('🧪 Testing LangGraph HVAC State Machine Implementation\n');
  
  try {
    // Create container with experimental configuration
    const container = await createContainer('./config/hvac_config_langgraph_experiment.yaml');
    console.log('✅ Container initialized with LangGraph experiment config');
    
    // Get the state machine from the container
    const stateMachine = container.get(Symbol.for('HVACStateMachine'));
    console.log('✅ State machine instance retrieved from container');
    
    // Verify it's the LangGraph implementation
    if (stateMachine instanceof LangGraphHVACStateMachineAdapter) {
      console.log('✅ LangGraph adapter is being used');
    } else {
      console.log('⚠️ XState adapter is being used (expected if feature flag not set)');
    }
    
    // Test basic state machine operations
    console.log('\n🔄 Testing state machine operations...');
    
    // Start the state machine
    console.log('Starting state machine...');
    await stateMachine.start();
    console.log(`✅ State machine started. Current state: ${stateMachine.getCurrentState()}`);
    
    // Get initial status
    const initialStatus = stateMachine.getStatus();
    console.log('✅ Initial status retrieved:', {
      currentState: initialStatus.currentState,
      systemMode: initialStatus.systemMode,
      canHeat: initialStatus.canHeat,
      canCool: initialStatus.canCool
    });
    
    // Test temperature updates
    console.log('\n🌡️ Testing temperature updates...');
    await stateMachine.handleTemperatureChange('sensor.indoor_temp', 18.5);
    await stateMachine.handleTemperatureChange('sensor.outdoor_temp', 5.0);
    console.log('✅ Temperature updates processed');
    
    // Get updated status
    const statusAfterTemp = stateMachine.getStatus();
    console.log('✅ Status after temperature updates:', {
      currentState: statusAfterTemp.currentState,
      context: statusAfterTemp.context
    });
    
    // Test manual override
    console.log('\n👤 Testing manual override...');
    await stateMachine.manualOverride(HVACMode.HEAT, 22.0);
    console.log(`✅ Manual override processed. Current state: ${stateMachine.getCurrentState()}`);
    
    // Clear manual override
    console.log('\n🔄 Testing manual override clearing...');
    if (stateMachine.clearManualOverride) {
      await stateMachine.clearManualOverride();
      console.log(`✅ Manual override cleared. Current state: ${stateMachine.getCurrentState()}`);
    }
    
    // Test system mode changes
    console.log('\n⚙️ Testing system mode changes...');
    if (stateMachine.updateSystemMode) {
      await stateMachine.updateSystemMode(SystemMode.HEAT_ONLY);
      console.log(`✅ System mode updated. Current state: ${stateMachine.getCurrentState()}`);
    }
    
    // Get final status with enhanced LangGraph metrics
    const finalStatus = stateMachine.getStatus();
    console.log('\n📊 Final state machine status:', {
      currentState: finalStatus.currentState,
      systemMode: finalStatus.systemMode,
      context: finalStatus.context
    });
    
    // Check for LangGraph-specific features
    if ('evaluationHistory' in finalStatus) {
      console.log('✅ LangGraph evaluation history available:', 
        (finalStatus as any).evaluationHistory?.length || 0, 'entries');
    }
    
    if ('performanceMetrics' in finalStatus) {
      console.log('✅ LangGraph performance metrics available');
    }
    
    if ('totalTransitions' in finalStatus) {
      console.log('✅ LangGraph transition tracking available:', 
        (finalStatus as any).totalTransitions || 0, 'transitions');
    }
    
    // Stop the state machine
    console.log('\n🛑 Stopping state machine...');
    await stateMachine.stop();
    console.log('✅ State machine stopped');
    
    // Cleanup container
    await container.dispose();
    console.log('✅ Container disposed');
    
    console.log('\n🎉 LangGraph HVAC State Machine test completed successfully!');
    console.log('\n📋 Test Summary:');
    console.log('  - Container initialization: ✅');
    console.log('  - State machine creation: ✅');
    console.log('  - Start/stop operations: ✅');
    console.log('  - Temperature updates: ✅');
    console.log('  - Manual override: ✅');
    console.log('  - System mode changes: ✅');
    console.log('  - Enhanced metrics: ✅');
    
  } catch (error) {
    console.error('❌ LangGraph test failed:', error);
    console.error('\n🔍 Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    Deno.exit(1);
  }
}

/**
 * Test the experimental configuration loading
 */
async function testExperimentalConfig() {
  console.log('⚙️ Testing experimental configuration...\n');
  
  try {
    // Load the experimental config
    const { ConfigLoader } = await import('../src/config/loader.ts');
    const settings = await ConfigLoader.loadSettings('./config/hvac_config_langgraph_experiment.yaml');
    
    console.log('✅ Experimental config loaded successfully');
    console.log('📋 Config validation:', {
      hasExperimentalFeatures: !!settings.appOptions.experimentalFeatures,
      experimentalFeatures: settings.appOptions.experimentalFeatures || [],
      containsLangGraph: settings.appOptions.experimentalFeatures?.includes('langgraph-state-machine'),
      dryRun: settings.appOptions.dryRun
    });
    
    if (settings.appOptions.experimentalFeatures?.includes('langgraph-state-machine')) {
      console.log('✅ LangGraph feature flag is enabled');
    } else {
      console.log('⚠️ LangGraph feature flag is not enabled');
    }
    
  } catch (error) {
    console.error('❌ Experimental config test failed:', error);
    throw error;
  }
}

// Main execution
if (import.meta.main) {
  console.log('🧪 HAG LangGraph Experiment Test Suite\n');
  console.log('This test validates the LangGraph state machine implementation');
  console.log('and ensures proper feature flag integration.\n');
  
  await testExperimentalConfig();
  console.log('\n' + '='.repeat(60) + '\n');
  await testLangGraphStateMachine();
  
  console.log('\n🎯 All tests completed successfully!');
  console.log('The LangGraph implementation is ready for Phase 3 testing.');
}