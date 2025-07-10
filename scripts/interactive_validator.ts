#!/usr/bin/env -S deno run --allow-all
/**
 * Interactive System Validator
 *
 * This script provides an interactive interface for validating
 * HAG system components through user prompts and confirmations.
 */

import {
  ConfigValidator,
  HealthChecker,
  ValidationHelper,
} from './validation_helpers.ts';

/**
 * Interactive validation runner
 */
class InteractiveValidator {
  private validator: ValidationHelper;
  private healthChecker: HealthChecker;
  private configValidator: ConfigValidator;

  constructor() {
    this.validator = new ValidationHelper();
    this.healthChecker = new HealthChecker();
    this.configValidator = new ConfigValidator();
  }

  /**
   * Run interactive validation session
   */
  async run() {
    console.log('🚀 HAG Interactive System Validator');
    console.log('===================================\n');

    // System requirements check
    if (
      await this.validator.promptForValidation('Check system requirements?')
    ) {
      this.validator.logStep('Checking system requirements');
      const systemResults = await this.healthChecker.checkSystemRequirements();
      this.validator.displayResults('System Requirements', systemResults);
      await this.validator.waitForContinue();
    }

    // Network connectivity check
    if (
      await this.validator.promptForValidation('Check network connectivity?')
    ) {
      this.validator.logStep('Checking network connectivity');
      const networkResults = await this.healthChecker
        .checkNetworkConnectivity();
      this.validator.displayResults('Network Connectivity', networkResults);
      await this.validator.waitForContinue();
    }

    // Configuration validation
    if (
      await this.validator.promptForValidation('Validate configuration files?')
    ) {
      this.validator.logStep('Validating configuration');
      const configPaths = [
        './config.yaml',
        './config/hvac_config.yaml',
        './target/hvac_config.yaml',
      ];

      for (const configPath of configPaths) {
        try {
          const configResults = await this.configValidator.validateConfigFile(
            configPath,
          );
          this.validator.displayResults(
            `Configuration: ${configPath}`,
            configResults,
          );
        } catch (error) {
          console.log(`❌ Failed to validate ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await this.validator.waitForContinue();
    }

    // Home Assistant connectivity
    if (
      await this.validator.promptForValidation(
        'Test Home Assistant connectivity?',
      )
    ) {
      console.log('🏠 Testing Home Assistant connectivity...');
      console.log(
        'Note: This requires HASS_URL and HASS_TOKEN environment variables',
      );

      const hassUrl = Deno.env.get('HASS_URL');
      const hassToken = Deno.env.get('HASS_TOKEN');

      if (hassUrl && hassToken) {
        try {
          const response = await fetch(`${hassUrl}/api/`, {
            headers: {
              'Authorization': `Bearer ${hassToken}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(5000),
          });

          this.validator.displayResults('Home Assistant API', [{
            name: 'API Connection',
            status: response.ok,
            details: `Status: ${response.status} ${response.statusText}`,
          }]);
        } catch (error) {
          this.validator.displayResults('Home Assistant API', [{
            name: 'API Connection',
            status: false,
            details: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }]);
        }
      } else {
        console.log('⚠️  HASS_URL or HASS_TOKEN not configured');
      }
      await this.validator.waitForContinue();
    }

    // AI components test
    if (
      await this.validator.promptForValidation(
        'Test AI components availability?',
      )
    ) {
      console.log('🤖 Testing AI components...');

      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      const aiResults = [];

      if (openaiKey) {
        try {
          // Test OpenAI API connectivity (without making actual API calls)
          aiResults.push({
            name: 'OpenAI API Key',
            status: openaiKey.startsWith('sk-') && openaiKey.length > 20,
            details: openaiKey.startsWith('sk-')
              ? 'Valid format'
              : 'Invalid format',
          });
        } catch (error) {
          aiResults.push({
            name: 'OpenAI Configuration',
            status: false,
            details: `Error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } else {
        aiResults.push({
          name: 'OpenAI API Key',
          status: false,
          details: 'OPENAI_API_KEY not configured',
        });
      }

      // Check AI module availability
      try {
        const aiModuleExists = await Deno.stat('./src/ai/decision-engine.ts');
        aiResults.push({
          name: 'AI Decision Engine Module',
          status: aiModuleExists.isFile,
          details: 'Module file found',
        });
      } catch {
        aiResults.push({
          name: 'AI Decision Engine Module',
          status: false,
          details: 'Module file not found',
        });
      }

      this.validator.displayResults('AI Components', aiResults);
      await this.validator.waitForContinue();
    }

    // Binary validation
    if (await this.validator.promptForValidation('Validate compiled binary?')) {
      console.log('⚙️  Testing compiled binary...');

      try {
        const binaryStat = await Deno.stat('./target/hag');
        const binaryResults = [{
          name: 'Binary Exists',
          status: binaryStat.isFile,
          details: `Size: ${Math.round(binaryStat.size / 1024 / 1024)}MB`,
        }];

        if (binaryStat.isFile) {
          // Test binary execution
          try {
            const process = new Deno.Command('./target/hag', {
              args: ['--version'],
              stdout: 'piped',
              stderr: 'piped',
            });

            const { code, stdout } = await process.output();
            const output = new TextDecoder().decode(stdout);

            binaryResults.push({
              name: 'Binary Execution',
              status: code === 0,
              details: code === 0
                ? `Version: ${output.trim()}`
                : 'Execution failed',
            });
          } catch (error) {
            binaryResults.push({
              name: 'Binary Execution',
              status: false,
              details: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        this.validator.displayResults('Binary Validation', binaryResults);
      } catch (error) {
        this.validator.displayResults('Binary Validation', [{
          name: 'Binary Access',
          status: false,
          details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }]);
      }
      await this.validator.waitForContinue();
    }

    console.log('\n🎉 Interactive validation completed!');
    console.log(
      'Use the test scripts in tests/ directory for comprehensive automated testing.',
    );
  }
}

// Run interactive validator if called directly
if (import.meta.main) {
  const validator = new InteractiveValidator();
  await validator.run();
}
