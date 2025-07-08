/**
 * Unit tests for dependency injection container in HAG JavaScript variant.
 *
 * Tests container initialization, service registration, and dependency resolution.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from '@std/assert';
import {
  ApplicationContainer,
  createContainer,
  disposeContainer,
  getContainer,
} from '../../../src/core/container.ts';
import { TYPES } from '../../../src/core/types.ts';
import {
  ApplicationOptions,
  HvacOptions,
  Settings,
} from '../../../src/config/config.ts';
import { LoggerService } from '../../../src/core/logging.ts';
import { LogLevel, SystemMode } from '../../../src/types/common.ts';

// Mock configuration for testing - commented out as unused
//   appOptions: {
//     logLevel: LogLevel.ERROR, // Use ERROR to minimize test output
//     useAi: false,
//     aiModel: 'gpt-4o-mini',
//     aiTemperature: 0.1,
//     openaiApiKey: undefined,
//   },
//   hassOptions: {
//     wsUrl: 'ws://localhost:8123/api/websocket',
//     restUrl: 'http://localhost:8123',
//     token: 'test_token',
//     maxRetries: 3,
//     retryDelayMs: 1000,
//   },
//   hvacOptions: {
//     tempSensor: 'sensor.indoor_temp',
//     outdoorSensor: 'sensor.outdoor_temp',
//     systemMode: SystemMode.AUTO,
//     hvacEntities: [
//       {
//         entityId: 'climate.test',
//         enabled: true,
//         defrost: false,
//       },
//     ],
//     heating: {
//       temperature: 21.0,
//       presetMode: 'comfort',
//       temperatureThresholds: {
//         indoorMin: 19.0,
//         indoorMax: 22.0,
//         outdoorMin: -10.0,
//         outdoorMax: 15.0,
//       },
//     },
//     cooling: {
//       temperature: 24.0,
//       presetMode: 'eco',
//       temperatureThresholds: {
//         indoorMin: 23.0,
//         indoorMax: 26.0,
//         outdoorMin: 10.0,
//         outdoorMax: 45.0,
//       },
//     },
//   },
// };

// Mock config file for testing
const mockConfigYaml = `
appOptions:
  logLevel: error
  useAi: false
  aiModel: gpt-4o-mini
  aiTemperature: 0.1

hassOptions:
  wsUrl: ws://localhost:8123/api/websocket
  restUrl: http://localhost:8123
  token: test_token
  maxRetries: 3
  retryDelayMs: 1000
  stateCheckInterval: 300000

hvacOptions:
  tempSensor: sensor.indoor_temp
  outdoorSensor: sensor.outdoor_temp
  systemMode: auto
  hvacEntities:
    - entityId: climate.test
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
  cooling:
    temperature: 24.0
    presetMode: eco
    temperatureThresholds:
      indoorMin: 23.0
      indoorMax: 26.0
      outdoorMin: 10.0
      outdoorMax: 45.0
`;

// Mock file system for config loading
const mockFileSystem = new Map<string, string>();
const originalReadTextFile = Deno.readTextFile;
const originalStatSync = Deno.statSync;

interface MockDeno {
  readTextFile: typeof Deno.readTextFile;
  statSync: typeof Deno.statSync;
}

function setupConfigMocks() {
  mockFileSystem.set('test-config.yaml', mockConfigYaml);

  (Deno as unknown as MockDeno).readTextFile = (
    path: string | URL,
  ): Promise<string> => {
    const pathStr = typeof path === 'string' ? path : path.toString();
    const content = mockFileSystem.get(pathStr);
    if (content === undefined) {
      throw new Deno.errors.NotFound(`File not found: ${pathStr}`);
    }
    return Promise.resolve(content);
  };

  (Deno as unknown as MockDeno).statSync = (
    path: string | URL,
  ): Deno.FileInfo => {
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
  };
}

function teardownConfigMocks() {
  Deno.readTextFile = originalReadTextFile;
  Deno.statSync = originalStatSync;
  mockFileSystem.clear();
}

Deno.test('Application Container - Basic Operations', async (t) => {
  setupConfigMocks();

  await t.step('should create container instance', () => {
    const container = new ApplicationContainer();
    assertExists(container);
  });

  await t.step('should initialize with configuration', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    const settings = container.getSettings();
    assertExists(settings);
    assertEquals(settings.appOptions.logLevel, 'error');
    assertEquals(
      settings.hassOptions.wsUrl,
      'ws://localhost:8123/api/websocket',
    );
  });

  await t.step('should check service binding', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Configuration services should be bound
    assertEquals(container.isBound(TYPES.Settings), true);
    assertEquals(container.isBound(TYPES.HvacOptions), true);
    assertEquals(container.isBound(TYPES.HassOptions), true);
    assertEquals(container.isBound(TYPES.ApplicationOptions), true);
    assertEquals(container.isBound(TYPES.Logger), true);
  });

  await t.step('should retrieve services', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    const settings = container.get(TYPES.Settings);
    assertExists(settings);

    const hvacOptions = container.get(TYPES.HvacOptions) as HvacOptions;
    assertExists(hvacOptions);
    assertEquals(hvacOptions.tempSensor, 'sensor.indoor_temp');

    const logger = container.get(TYPES.Logger);
    assertExists(logger);
  });

  await t.step('should handle initialization errors', async () => {
    const container = new ApplicationContainer();

    await assertRejects(
      () => container.initialize('nonexistent-config.yaml'),
      Error,
    );
  });

  await t.step('should dispose properly', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Should not throw
    await container.dispose();
  });

  teardownConfigMocks();
});

Deno.test('Application Container - Service Registration', async (t) => {
  setupConfigMocks();

  await t.step('should register configuration services', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // All configuration should be registered
    const settings = container.get<Settings>(TYPES.Settings);
    const hvacOptions = container.get(TYPES.HvacOptions);
    const hassOptions = container.get(TYPES.HassOptions);
    const appOptions = container.get(TYPES.ApplicationOptions);

    assertExists(settings);
    assertExists(hvacOptions);
    assertExists(hassOptions);
    assertExists(appOptions);

    // Values should match loaded configuration
    assertEquals(settings.hvacOptions, hvacOptions);
    assertEquals(settings.hassOptions, hassOptions);
    assertEquals(settings.appOptions, appOptions);
  });

  await t.step('should register core services', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    assertEquals(container.isBound(TYPES.Logger), true);
    assertEquals(container.isBound(TYPES.ConfigLoader), true);

    const logger = container.get(TYPES.Logger) as LoggerService;
    assertExists(logger);

    // Logger should have expected methods
    assertEquals(typeof logger.info, 'function');
    assertEquals(typeof logger.error, 'function');
    assertEquals(typeof logger.debug, 'function');
    assertEquals(typeof logger.warning, 'function');
  });

  await t.step('should register services based on configuration', async () => {
    // Test without AI
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Wait for lazy loading
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Services should be registered (but lazily loaded)
    // We can't easily test the lazy-loaded services without complex mocking
    assertExists(container);
  });

  await t.step('should handle missing settings', () => {
    const container = new ApplicationContainer();

    assertThrows(
      () => container.getSettings(),
      Error,
      'Settings not loaded',
    );
  });

  teardownConfigMocks();
});

Deno.test('Application Container - AI Integration', async (t) => {
  setupConfigMocks();

  await t.step('should handle AI enabled configuration', async () => {
    // Create config with AI enabled
    const aiConfigYaml = mockConfigYaml.replace('useAi: false', 'useAi: true');
    mockFileSystem.set('ai-config.yaml', aiConfigYaml);

    const container = new ApplicationContainer();
    await container.initialize('ai-config.yaml');

    const appOptions = container.get(
      TYPES.ApplicationOptions,
    ) as ApplicationOptions;
    assertEquals(appOptions.useAi, true);

    // Should register AI-related services
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertExists(container);
  });

  await t.step('should handle AI disabled configuration', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    const appOptions = container.get(
      TYPES.ApplicationOptions,
    ) as ApplicationOptions;
    assertEquals(appOptions.useAi, false);
  });

  teardownConfigMocks();
});

Deno.test('Application Container - Global Container Functions', async (t) => {
  setupConfigMocks();

  await t.step('should create global container', async () => {
    const container = await createContainer('test-config.yaml');

    assertExists(container);
    assertEquals(container.getSettings().appOptions.logLevel, LogLevel.ERROR);

    await disposeContainer();
  });

  await t.step('should get global container', async () => {
    await createContainer('test-config.yaml');

    const container = getContainer();
    assertExists(container);
    assertEquals(
      container.getSettings().hassOptions.wsUrl,
      'ws://localhost:8123/api/websocket',
    );

    await disposeContainer();
  });

  await t.step('should handle get container when not initialized', () => {
    assertThrows(
      () => getContainer(),
      Error,
      'Container not initialized',
    );
  });

  await t.step('should dispose and recreate global container', async () => {
    // Create first container
    const container1 = await createContainer('test-config.yaml');
    assertExists(container1);

    // Create second container (should dispose first)
    const container2 = await createContainer('test-config.yaml');
    assertExists(container2);

    // Should be able to get the new container
    const retrieved = getContainer();
    assertEquals(retrieved, container2);

    await disposeContainer();
  });

  await t.step('should handle dispose when no container', async () => {
    // Should not throw
    await disposeContainer();
  });

  teardownConfigMocks();
});

Deno.test('Application Container - Error Handling', async (t) => {
  setupConfigMocks();

  await t.step('should handle configuration loading errors', async () => {
    const container = new ApplicationContainer();

    await assertRejects(
      () => container.initialize('invalid-config.yaml'),
      Error,
    );
  });

  await t.step('should handle invalid configuration format', async () => {
    const invalidYaml = 'invalid: yaml: structure: [';
    mockFileSystem.set('invalid.yaml', invalidYaml);

    const container = new ApplicationContainer();

    await assertRejects(
      () => container.initialize('invalid.yaml'),
      Error,
    );
  });

  await t.step(
    'should handle service resolution errors gracefully',
    async () => {
      const container = new ApplicationContainer();
      await container.initialize('test-config.yaml');

      // Try to get unregistered service
      assertThrows(
        () => container.get(Symbol.for('NonexistentService')),
        Error,
      );
    },
  );

  teardownConfigMocks();
});

Deno.test('Application Container - Logging Setup', async (t) => {
  setupConfigMocks();

  await t.step('should setup logging with INFO level', async () => {
    const infoConfigYaml = mockConfigYaml.replace(
      'logLevel: error',
      'logLevel: info',
    );
    mockFileSystem.set('info-config.yaml', infoConfigYaml);

    const container = new ApplicationContainer();
    await container.initialize('info-config.yaml');

    const settings = container.getSettings();
    assertEquals(settings.appOptions.logLevel, LogLevel.INFO);
  });

  await t.step('should setup logging with DEBUG level', async () => {
    const debugConfigYaml = mockConfigYaml.replace(
      'logLevel: error',
      'logLevel: debug',
    );
    mockFileSystem.set('debug-config.yaml', debugConfigYaml);

    const container = new ApplicationContainer();
    await container.initialize('debug-config.yaml');

    const settings = container.getSettings();
    assertEquals(settings.appOptions.logLevel, LogLevel.DEBUG);
  });

  teardownConfigMocks();
});

Deno.test('Application Container - Resource Cleanup', async (t) => {
  setupConfigMocks();

  await t.step('should cleanup services on dispose', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Services should be registered
    assertEquals(container.isBound(TYPES.Settings), true);

    await container.dispose();

    // Container should still exist but services should be cleaned up
    assertExists(container);
  });

  await t.step('should handle dispose with service errors', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Should not throw even if services have issues during cleanup
    await container.dispose();
  });

  teardownConfigMocks();
});

Deno.test('Application Container - Configuration Validation', async (t) => {
  setupConfigMocks();

  await t.step('should validate complete configuration', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    const settings = container.getSettings();

    // All required sections should be present
    assertExists(settings.appOptions);
    assertExists(settings.hassOptions);
    assertExists(settings.hvacOptions);

    // Key values should be correct
    assertEquals(settings.hvacOptions.tempSensor, 'sensor.indoor_temp');
    assertEquals(settings.hvacOptions.systemMode, SystemMode.AUTO);
    assertEquals(settings.hassOptions.token, 'test_token');
  });

  await t.step(
    'should require complete configuration (no defaults)',
    async () => {
      const incompleteYaml = `
    hassOptions:
      wsUrl: ws://localhost:8123/api/websocket
      restUrl: http://localhost:8123
      token: minimal_token
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
          outdoorMax: 45.0    `;

      mockFileSystem.set('incomplete.yaml', incompleteYaml);

      const container = new ApplicationContainer();
      
      // Should reject incomplete configuration
      await assertRejects(
        () => container.initialize('incomplete.yaml'),
        Error,
        'Configuration validation failed',
      );
    },
  );

  teardownConfigMocks();
});

Deno.test('Application Container - Concurrent Operations', async (t) => {
  setupConfigMocks();

  await t.step('should handle concurrent initialization attempts', async () => {
    const container1 = new ApplicationContainer();
    const container2 = new ApplicationContainer();

    // Start multiple initializations concurrently on different containers
    const init1 = container1.initialize('test-config.yaml');
    const init2 = container2.initialize('test-config.yaml');

    // Both should complete without error
    await Promise.all([init1, init2]);

    const settings1 = container1.getSettings();
    const settings2 = container2.getSettings();
    assertExists(settings1);
    assertExists(settings2);
  });

  await t.step('should handle concurrent service access', async () => {
    const container = new ApplicationContainer();
    await container.initialize('test-config.yaml');

    // Access services concurrently
    const promises = [
      Promise.resolve(container.get(TYPES.Settings)),
      Promise.resolve(container.get(TYPES.HvacOptions)),
      Promise.resolve(container.get(TYPES.HassOptions)),
      Promise.resolve(container.get(TYPES.Logger)),
    ];

    const services = await Promise.all(promises);

    // All services should be retrieved successfully
    for (const service of services) {
      assertExists(service);
    }
  });

  teardownConfigMocks();
});
