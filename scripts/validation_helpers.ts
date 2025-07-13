#!/usr/bin/env bun
/**
 * Validation Helper Utilities
 *
 * This module provides helper functions for prompt-driven validation
 * and interactive system testing.
 */

import { LoggerService } from '../src/core/logging.ts';

/**
 * Interactive validation helper for system components
 */
export class ValidationHelper {
  private logger: LoggerService;

  constructor() {
    this.logger = new LoggerService('validation-helper');
  }

  /**
   * Prompt user for validation confirmation
   */
  async promptForValidation(message: string): Promise<boolean> {
    console.log(`\n🔍 ${message}`);
    console.log('Enter "y" to confirm, any other key to skip:');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const input = await new Promise<string>((resolve) => {
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase());
      });
    });

    return input === 'y' || input === 'yes';
  }

  /**
   * Display validation results with emoji indicators
   */
  displayResults(
    title: string,
    results: Array<{ name: string; status: boolean; details?: string }>,
  ) {
    console.log(`\n📊 ${title}`);
    console.log('='.repeat(50));

    results.forEach((result) => {
      const icon = result.status ? '✅' : '❌';
      console.log(`${icon} ${result.name}`);
      if (result.details) {
        console.log(`   ${result.details}`);
      }
    });

    const passedCount = results.filter((r) => r.status).length;
    const successRate = Math.round((passedCount / results.length) * 100);

    console.log(
      `\n📈 Success Rate: ${successRate}% (${passedCount}/${results.length})`,
    );
  }

  /**
   * Log validation step with timestamp
   */
  logStep(step: string, details?: Record<string, unknown>) {
    this.logger.info(`🔍 [Validation] ${step}`, details);
  }

  /**
   * Wait for user input to continue
   */
  async waitForContinue(message: string = 'Press Enter to continue...') {
    console.log(`\n⏸️  ${message}`);
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise<void>((resolve) => {
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
  }
}

/**
 * System health checker utility
 */
export class HealthChecker {
  private logger: LoggerService;

  constructor() {
    this.logger = new LoggerService('health-checker');
  }

  /**
   * Check basic system requirements
   */
  async checkSystemRequirements(): Promise<
    { name: string; status: boolean; details: string }[]
  > {
    const results = [];

    // Check Bun version
    try {
      const bunVersion = Bun.version;
      results.push({
        name: 'Bun Runtime',
        status: true,
        details: `Version: ${bunVersion}`,
      });
    } catch (error) {
      results.push({
        name: 'Bun Runtime',
        status: false,
        details: `Failed to check version: ${error}`,
      });
    }

    // Check environment variables
    const requiredEnvVars = ['HOME', 'PATH'];
    for (const envVar of requiredEnvVars) {
      const value = process.env[envVar];
      results.push({
        name: `Environment Variable: ${envVar}`,
        status: !!value,
        details: value ? 'Set' : 'Not set',
      });
    }

    // Check file system permissions
    try {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempFile = path.join(os.tmpdir(), 'test-file-' + Date.now());
      await fs.promises.writeFile(tempFile, 'test');
      await fs.promises.unlink(tempFile);
      results.push({
        name: 'File System Access',
        status: true,
        details: 'Read/write permissions available',
      });
    } catch (error) {
      results.push({
        name: 'File System Access',
        status: false,
        details: `Permission error: ${error}`,
      });
    }

    return results;
  }

  /**
   * Check network connectivity
   */
  async checkNetworkConnectivity(): Promise<
    { name: string; status: boolean; details: string }[]
  > {
    const results = [];

    // Test basic HTTP connectivity
    try {
      const response = await fetch('https://httpbin.org/status/200', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        name: 'HTTP Connectivity',
        status: response.ok,
        details: `Status: ${response.status}`,
      });
    } catch (error) {
      results.push({
        name: 'HTTP Connectivity',
        status: false,
        details: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Test DNS resolution
    try {
      const start = Date.now();
      await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      const latency = Date.now() - start;
      results.push({
        name: 'DNS Resolution',
        status: true,
        details: `Latency: ${latency}ms`,
      });
    } catch (error) {
      results.push({
        name: 'DNS Resolution',
        status: false,
        details: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return results;
  }
}

/**
 * Configuration validator utility
 */
export class ConfigValidator {
  /**
   * Validate configuration file structure
   */
  async validateConfigFile(
    configPath: string,
  ): Promise<{ name: string; status: boolean; details: string }[]> {
    const results = [];

    try {
      const fs = await import('fs');
      const configStat = await fs.promises.stat(configPath);
      results.push({
        name: 'Configuration File Exists',
        status: configStat.isFile,
        details: configStat.isFile ? 'File found' : 'Not a file',
      });

      if (configStat.isFile) {
        const configContent = await fs.promises.readFile(configPath, 'utf8');
        results.push({
          name: 'Configuration File Readable',
          status: configContent.length > 0,
          details: `Size: ${configContent.length} characters`,
        });

        // Basic YAML structure check
        const hasHomeAssistant = configContent.includes('homeAssistant');
        const hasHvac = configContent.includes('hvac');

        results.push({
          name: 'Home Assistant Configuration',
          status: hasHomeAssistant,
          details: hasHomeAssistant ? 'Section found' : 'Section missing',
        });

        results.push({
          name: 'HVAC Configuration',
          status: hasHvac,
          details: hasHvac ? 'Section found' : 'Section missing',
        });
      }
    } catch (error) {
      results.push({
        name: 'Configuration File Access',
        status: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return results;
  }
}

// Export utilities for use in other scripts
export { ValidationHelper as default };
