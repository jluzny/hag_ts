/**
 * Unit tests for configuration loader in HAG JavaScript variant.
 * 
 * Tests YAML file loading, environment variable substitution, and validation.
 */

import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { ConfigLoader } from '../../../src/config/loader.ts';
import { ConfigurationError } from '../../../src/core/exceptions.ts';
import { SystemMode, LogLevel } from '../../../src/types/common.ts';

// Mock file system operations
const mockFileSystem = new Map<string, string>();
const mockEnvironment = new Map<string, string>();
let shouldFailFileRead = false;

// Store original functions
const originalReadTextFile = Deno.readTextFile;
const originalStatSync = Deno.statSync;
const originalEnvGet = Deno.env.get;

// Mock Deno.readTextFile
function mockReadTextFile(path: string | URL): Promise<string> {
  if (shouldFailFileRead) {
    return Promise.reject(new Deno.errors.NotFound(`File not found: ${path}`));
  }
  
  const pathStr = typeof path === 'string' ? path : path.toString();
  const content = mockFileSystem.get(pathStr);
  if (content === undefined) {
    return Promise.reject(new Deno.errors.NotFound(`File not found: ${pathStr}`));
  }
  
  return Promise.resolve(content);
}

// Mock Deno.statSync
function mockStatSync(path: string | URL): Deno.FileInfo {
  const pathStr = typeof path === 'string' ? path : path.toString();
  if (mockFileSystem.has(pathStr)) {
    return {
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      size: mockFileSystem.get(pathStr)!.length,
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      ctime: new Date(),
      dev: 1,
      ino: 1,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      blksize: 4096,
      blocks: 1,
      isBlockDevice: false,
      isCharDevice: false,
      isFifo: false,
      isSocket: false,
    };
  }
  throw new Deno.errors.NotFound(`File not found: ${pathStr}`);
}

// Mock Deno.env.get
function mockEnvGet(key: string): string | undefined {
  return mockEnvironment.get(key);
}

// Test setup and teardown
interface MockDeno {
  readTextFile: typeof Deno.readTextFile;
  statSync: (path: string | URL) => Deno.FileInfo;
  env: {
    get: typeof Deno.env.get;
  };
}

function setupMocks() {
  (Deno as unknown as MockDeno).readTextFile = mockReadTextFile;
  (Deno as unknown as MockDeno).statSync = mockStatSync;
  (Deno as unknown as MockDeno).env.get = mockEnvGet;
}

function teardownMocks() {
  Deno.readTextFile = originalReadTextFile;
  Deno.statSync = originalStatSync;
  Deno.env.get = originalEnvGet;
  mockFileSystem.clear();
  mockEnvironment.clear();
  shouldFailFileRead = false;
}

// Valid test configuration
const validYamlConfig = `
appOptions:
  logLevel: info
  useAi: false
  aiModel: gpt-4o-mini

hassOptions:
  wsUrl: ws://localhost:8123/api/websocket
  restUrl: http://localhost:8123
  token: test_token
  maxRetries: 5
  retryDelayMs: 2000

hvacOptions:
  tempSensor: sensor.indoor_temperature
  outdoorSensor: sensor.outdoor_temperature
  systemMode: auto
  hvacEntities:
    - entityId: climate.living_room
      enabled: true
      defrost: false
  heating:
    temperature: 21.0
    presetMode: comfort
    temperatureThresholds:
      indoorMin: 19.0
      indoorMax: 22.0
      outdoorMin: -10.0
      outdoorMax: 15.0
    defrost:
      temperatureThreshold: 0.0
      periodSeconds: 3600
      durationSeconds: 300
  cooling:
    temperature: 24.0
    presetMode: eco
    temperatureThresholds:
      indoorMin: 23.0
      indoorMax: 26.0
      outdoorMin: 10.0
      outdoorMax: 45.0
  activeHours:
    start: 8
    startWeekday: 7
    end: 22
`;

Deno.test('Config Loader - YAML File Loading', async (t) => {
  setupMocks();

  await t.step('should load valid YAML configuration', async () => {
    mockFileSystem.set('config/hvac_config.yaml', validYamlConfig);
    
    const settings = await ConfigLoader.loadSettings('config/hvac_config.yaml');
    
    assertExists(settings);
    assertEquals(settings.appOptions.logLevel, LogLevel.INFO);
    assertEquals(settings.hassOptions.wsUrl, 'ws://localhost:8123/api/websocket');
    assertEquals(settings.hvacOptions.tempSensor, 'sensor.indoor_temperature');
    assertEquals(settings.hvacOptions.systemMode, SystemMode.AUTO);
  });

  await t.step('should handle file not found', async () => {
    await assertRejects(
      () => ConfigLoader.loadSettings('nonexistent.yaml'),
      ConfigurationError,
      'Configuration file not found'
    );
  });

  await t.step('should handle invalid YAML', async () => {
    const invalidYaml = `
    appOptions:
      logLevel: INFO
    hassOptions: [invalid yaml structure
    `;
    
    mockFileSystem.set('invalid.yaml', invalidYaml);
    
    await assertRejects(
      () => ConfigLoader.loadSettings('invalid.yaml'),
      ConfigurationError,
    );
  });

  await t.step('should handle file read errors', async () => {
    shouldFailFileRead = true;
    
    await assertRejects(
      () => ConfigLoader.loadSettings('config/hvac_config.yaml'),
      ConfigurationError,
      'Configuration file not found'
    );
  });

  teardownMocks();
});

Deno.test('Config Loader - Environment Variable Overrides', async (t) => {
  setupMocks();

  await t.step('should apply Home Assistant environment overrides', async () => {
    const baseConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: original_token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating:
        temperatureThresholds:
          indoorMin: 19.0
          indoorMax: 22.0
          outdoorMin: -10.0
          outdoorMax: 15.0
      cooling:
        temperatureThresholds:
          indoorMin: 23.0
          indoorMax: 26.0
          outdoorMin: 10.0
          outdoorMax: 45.0
    `;
    
    mockFileSystem.set('config.yaml', baseConfig);
    mockEnvironment.set('HASS_WS_URL', 'ws://production:8123/api/websocket');
    mockEnvironment.set('HASS_REST_URL', 'https://production:8123');
    mockEnvironment.set('HASS_TOKEN', 'production_token');
    mockEnvironment.set('HASS_MAX_RETRIES', '10');
    
    const settings = await ConfigLoader.loadSettings('config.yaml');
    
    assertEquals(settings.hassOptions.wsUrl, 'ws://production:8123/api/websocket');
    assertEquals(settings.hassOptions.restUrl, 'https://production:8123');
    assertEquals(settings.hassOptions.token, 'production_token');
    assertEquals(settings.hassOptions.maxRetries, 10);
  });

  await t.step('should apply application environment overrides', async () => {
    const baseConfig = `
    appOptions:
      logLevel: INFO
      useAi: false
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating:
        temperatureThresholds:
          indoorMin: 19.0
          indoorMax: 22.0
          outdoorMin: -10.0
          outdoorMax: 15.0
      cooling:
        temperatureThresholds:
          indoorMin: 23.0
          indoorMax: 26.0
          outdoorMin: 10.0
          outdoorMax: 45.0
    `;
    
    mockFileSystem.set('config.yaml', baseConfig);
    mockEnvironment.set('HAG_LOG_LEVEL', 'debug');
    mockEnvironment.set('HAG_USE_AI', 'true');
    mockEnvironment.set('HAG_AI_MODEL', 'gpt-4');
    mockEnvironment.set('OPENAI_API_KEY', 'sk-test-key');
    
    const settings = await ConfigLoader.loadSettings('config.yaml');
    
    assertEquals(settings.appOptions.logLevel, 'debug');
    assertEquals(settings.appOptions.useAi, true);
    assertEquals(settings.appOptions.aiModel, 'gpt-4');
  });

  await t.step('should apply HVAC environment overrides', async () => {
    const baseConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.original
      outdoorSensor: sensor.outdoor_original
      systemMode: auto
      hvacEntities: []
      heating:
        temperatureThresholds:
          indoorMin: 19.0
          indoorMax: 22.0
          outdoorMin: -10.0
          outdoorMax: 15.0
      cooling:
        temperatureThresholds:
          indoorMin: 23.0
          indoorMax: 26.0
          outdoorMin: 10.0
          outdoorMax: 45.0
    `;
    
    mockFileSystem.set('config.yaml', baseConfig);
    mockEnvironment.set('HAG_TEMP_SENSOR', 'sensor.new_temp');
    mockEnvironment.set('HAG_OUTDOOR_SENSOR', 'sensor.new_outdoor');
    mockEnvironment.set('HAG_SYSTEM_MODE', 'heat_only');
    
    const settings = await ConfigLoader.loadSettings('config.yaml');
    
    assertEquals(settings.hvacOptions.tempSensor, 'sensor.new_temp');
    assertEquals(settings.hvacOptions.outdoorSensor, 'sensor.new_outdoor');
    assertEquals(settings.hvacOptions.systemMode, 'heat_only');
  });

  await t.step('should handle missing environment variables gracefully', async () => {
    mockEnvironment.clear();
    const baseConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating:
        temperatureThresholds:
          indoorMin: 19.0
          indoorMax: 22.0
          outdoorMin: -10.0
          outdoorMax: 15.0
      cooling:
        temperatureThresholds:
          indoorMin: 23.0
          indoorMax: 26.0
          outdoorMin: 10.0
          outdoorMax: 45.0
    `;
    
    mockFileSystem.set('config.yaml', baseConfig);
    // No environment variables set
    
    const settings = await ConfigLoader.loadSettings('config.yaml');
    
    // Should use original values from file
    assertEquals(settings.hassOptions.wsUrl, 'ws://localhost:8123/api/websocket');
    assertEquals(settings.hvacOptions.tempSensor, 'sensor.temp');
  });

  teardownMocks();
});

Deno.test('Config Loader - Configuration Validation', async (t) => {
  setupMocks();

  await t.step('should validate required fields', async () => {
    const invalidConfig = `
    appOptions:
      logLevel: INFO
    # Missing required hassOptions
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating: {}
      cooling: {}
    `;
    
    mockFileSystem.set('invalid.yaml', invalidConfig);
    
    await assertRejects(
      () => ConfigLoader.loadSettings('invalid.yaml'),
      ConfigurationError,
      'Configuration validation failed'
    );
  });

  await t.step('should validate URL formats', async () => {
    const invalidUrlConfig = `
    hassOptions:
      wsUrl: invalid-url
      restUrl: also-invalid
      token: token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating: {}
      cooling: {}
    `;
    
    mockFileSystem.set('invalid-url.yaml', invalidUrlConfig);
    
    await assertRejects(
      () => ConfigLoader.loadSettings('invalid-url.yaml'),
      ConfigurationError,
      'Configuration validation failed'
    );
  });

  await t.step('should validate temperature ranges', async () => {
    const invalidTempConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating:
        temperature: 50.0  # Above maximum
      cooling:
        temperature: 10.0  # Below minimum
    `;
    
    mockFileSystem.set('invalid-temp.yaml', invalidTempConfig);
    
    await assertRejects(
      () => ConfigLoader.loadSettings('invalid-temp.yaml'),
      ConfigurationError,
      'Configuration validation failed'
    );
  });

  await t.step('should validate entity ID formats', async () => {
    const invalidEntityConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: invalid_entity_format
      hvacEntities: []
      heating: {}
      cooling: {}
    `;
    
    mockFileSystem.set('invalid-entity.yaml', invalidEntityConfig);
    
    await assertRejects(
      () => ConfigLoader.loadSettings('invalid-entity.yaml'),
      ConfigurationError,
      'Configuration validation failed'
    );
  });

  teardownMocks();
});

Deno.test('Config Loader - Default Values', async (t) => {
  setupMocks();

  await t.step('should apply default values for missing optional fields', async () => {
    const minimalConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.indoor_temperature
      hvacEntities: []
      heating: {}
      cooling: {}
    `;
    
    mockFileSystem.set('minimal.yaml', minimalConfig);
    
    const settings = await ConfigLoader.loadSettings('minimal.yaml');
    
    // Should have default values
    assertEquals(settings.appOptions.logLevel, LogLevel.INFO);
    assertEquals(settings.appOptions.useAi, false);
    assertEquals(settings.hassOptions.maxRetries, 5);
    assertEquals(settings.hassOptions.retryDelayMs, 1000);
    assertEquals(settings.hvacOptions.systemMode, SystemMode.AUTO);
    assertEquals(settings.hvacOptions.outdoorSensor, 'sensor.openweathermap_temperature');
  });

  await t.step('should preserve provided values over defaults', async () => {
    const configWithValues = `
    appOptions:
      logLevel: error
      useAi: true
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
      maxRetries: 10
    hvacOptions:
      tempSensor: sensor.indoor_temperature
      systemMode: cool_only
      hvacEntities: []
      heating: {}
      cooling: {}
    `;
    
    mockFileSystem.set('with-values.yaml', configWithValues);
    
    const settings = await ConfigLoader.loadSettings('with-values.yaml');
    
    // Should use provided values, not defaults
    assertEquals(settings.appOptions.logLevel, LogLevel.ERROR);
    assertEquals(settings.appOptions.useAi, true);
    assertEquals(settings.hassOptions.maxRetries, 10);
    assertEquals(settings.hvacOptions.systemMode, SystemMode.COOL_ONLY);
  });

  teardownMocks();
});

Deno.test('Config Loader - File Discovery', async (t) => {
  setupMocks();

  await t.step('should find config in standard locations', async () => {
    // Mock home directory
    mockEnvironment.set('HOME', '/home/user');
    
    // Test different locations
    const locations = [
      'config/hvac_config.yaml',
      'hvac_config.yaml',
      '/home/user/.config/hag/hvac_config.yaml',
      '/etc/hag/hvac_config.yaml',
    ];
    
    for (const location of locations) {
      mockFileSystem.clear();
      mockFileSystem.set(location, validYamlConfig);
      
      // Should find the config automatically
      const settings = await ConfigLoader.loadSettings();
      assertExists(settings);
    }
  });

  await t.step('should respect HAG_CONFIG_FILE environment variable', async () => {
    const customPath = '/custom/path/config.yaml';
    mockEnvironment.set('HAG_CONFIG_FILE', customPath);
    mockFileSystem.set(customPath, validYamlConfig);
    
    const settings = await ConfigLoader.loadSettings();
    assertExists(settings);
  });

  await t.step('should handle no config file found gracefully', async () => {
    // No config files exist
    mockFileSystem.clear();
    
    await assertRejects(
      () => ConfigLoader.loadSettings(),
      ConfigurationError,
      'Configuration file not found'
    );
  });

  teardownMocks();
});

Deno.test('Config Loader - Validation Helper', async (t) => {
  setupMocks();

  await t.step('should validate config file successfully', async () => {
    mockFileSystem.set('valid.yaml', validYamlConfig);
    
    const result = await ConfigLoader.validateConfigFile('valid.yaml');
    
    assertEquals(result.valid, true);
    assertExists(result.config);
    assertEquals(result.errors, undefined);
  });

  await t.step('should return validation errors', async () => {
    const invalidConfig = `
    appOptions:
      logLevel: INVALID_LEVEL
    hassOptions:
      wsUrl: invalid-url
      token: token
    `;
    
    mockFileSystem.set('invalid.yaml', invalidConfig);
    
    const result = await ConfigLoader.validateConfigFile('invalid.yaml');
    
    assertEquals(result.valid, false);
    assertExists(result.errors);
    assertEquals(result.config, undefined);
  });

  await t.step('should handle file read errors in validation', async () => {
    const result = await ConfigLoader.validateConfigFile('nonexistent.yaml');
    
    assertEquals(result.valid, false);
    assertExists(result.errors);
  });

  teardownMocks();
});

Deno.test('Config Loader - Environment Information', async (t) => {
  setupMocks();

  await t.step('should provide environment information', () => {
    mockEnvironment.set('OPENAI_API_KEY', 'sk-test-key');
    mockEnvironment.set('LANGCHAIN_API_KEY', 'lc-test-key');
    mockEnvironment.set('HAG_CONFIG_FILE', '/custom/config.yaml');
    
    const envInfo = ConfigLoader.getEnvironmentInfo();
    
    assertExists(envInfo.deno);
    assertExists(envInfo.platform);
    assertExists(envInfo.environment);
    
    assertEquals((envInfo.environment as any).hasOpenAI, true);
    assertEquals((envInfo.environment as any).hasLangSmith, true);
    assertEquals((envInfo.environment as any).configFile, '/custom/config.yaml');
  });

  await t.step('should handle missing environment variables', () => {
    mockEnvironment.clear();
    
    const envInfo = ConfigLoader.getEnvironmentInfo();
    
    assertEquals((envInfo.environment as any).hasOpenAI, false);
    assertEquals((envInfo.environment as any).hasLangSmith, false);
    assertEquals((envInfo.environment as any).configFile, undefined);
  });

  teardownMocks();
});

Deno.test('Config Loader - Complex Configuration Scenarios', async (t) => {
  setupMocks();

  await t.step('should handle complete configuration with all options', async () => {
    const complexConfig = `
    appOptions:
      logLevel: debug
      useAi: true
      aiModel: gpt-4
      aiTemperature: 0.3
      openaiApiKey: sk-test-key

    hassOptions:
      wsUrl: ws://ha.example.com:8123/api/websocket
      restUrl: https://ha.example.com:8123
      token: long_lived_access_token_here
      maxRetries: 5
      retryDelayMs: 2000

    hvacOptions:
      tempSensor: sensor.indoor_temperature
      outdoorSensor: sensor.outdoor_temperature
      systemMode: auto
      hvacEntities:
        - entityId: climate.living_room
          enabled: true
          defrost: true
        - entityId: climate.bedroom
          enabled: true
          defrost: false
        - entityId: climate.office
          enabled: false
          defrost: false
      heating:
        temperature: 20.5
        presetMode: comfort
        temperatureThresholds:
          indoorMin: 18.0
          indoorMax: 21.0
          outdoorMin: -15.0
          outdoorMax: 10.0
        defrost:
          temperatureThreshold: -2.0
          periodSeconds: 7200
          durationSeconds: 600
      cooling:
        temperature: 25.0
        presetMode: quiet
        temperatureThresholds:
          indoorMin: 24.0
          indoorMax: 27.0
          outdoorMin: 15.0
          outdoorMax: 40.0
      activeHours:
        start: 7
        startWeekday: 6
        end: 23
    `;
    
    mockFileSystem.set('complex.yaml', complexConfig);
    
    const settings = await ConfigLoader.loadSettings('complex.yaml');
    
    // Verify all sections loaded correctly
    assertEquals(settings.appOptions.useAi, true);
    assertEquals(settings.appOptions.aiModel, 'gpt-4');
    assertEquals(settings.hassOptions.maxRetries, 5);
    assertEquals(settings.hvacOptions.hvacEntities.length, 3);
    assertEquals(settings.hvacOptions.heating.defrost?.periodSeconds, 7200);
    assertEquals(settings.hvacOptions.activeHours?.startWeekday, 6);
  });

  await t.step('should handle nested merging with defaults', async () => {
    const partialConfig = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: token
    hvacOptions:
      tempSensor: sensor.temp
      hvacEntities: []
      heating:
        temperature: 19.0
        temperatureThresholds:
          indoorMin: 17.0
          indoorMax: 22.0
          outdoorMin: -10.0
          outdoorMax: 15.0
      cooling:
        temperature: 24.0
        presetMode: windFreeSleep
        temperatureThresholds:
          indoorMin: 23.0
          indoorMax: 26.0
          outdoorMin: 10.0
          outdoorMax: 45.0
    `;
    
    mockFileSystem.set('partial.yaml', partialConfig);
    
    const settings = await ConfigLoader.loadSettings('partial.yaml');
    
    // Should merge with defaults properly
    assertEquals(settings.hvacOptions.heating.temperature, 19.0);
    assertEquals(settings.hvacOptions.heating.temperatureThresholds.indoorMin, 17.0);
    // These should come from defaults
    assertExists(settings.hvacOptions.heating.temperatureThresholds.indoorMax);
    assertExists(settings.hvacOptions.heating.temperatureThresholds.outdoorMin);
    assertEquals(settings.hvacOptions.cooling.presetMode, 'windFreeSleep');
    assertExists(settings.hvacOptions.cooling.temperature);
  });

  teardownMocks();
});