/**
 * Unit tests for dependency injection container in HAG JavaScript variant.
 *
 * Tests container initialization, service registration, and dependency resolution.
 */

import { expect, test, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import {
  ApplicationContainer,
  createContainer,
  disposeContainer,
  getContainer,
} from "../../../src/core/container.ts";
import { TYPES } from "../../../src/core/types.ts";
import { HvacOptions, Settings } from "../../../src/config/config.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import { LogLevel, SystemMode } from "../../../src/types/common.ts";
import { setupTestLogging } from "../../test-helpers.ts";
import * as fs from "fs";
import * as path from "path";

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
  stateCheckInterval: 1000

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

const testConfigPath = path.join(process.cwd(), "test-config.yaml");

describe("Application Container - Basic Operations", () => {
  let sharedContainer: ApplicationContainer;

  beforeAll(async () => {
    // Setup test logging to reduce noise
    setupTestLogging();
    // Create test config file once
    fs.writeFileSync(testConfigPath, mockConfigYaml);
    // Initialize shared container once
    sharedContainer = new ApplicationContainer();
    await sharedContainer.initialize(testConfigPath);
  });

  afterAll(async () => {
    // Clean up test config file
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    // Dispose shared container
    await sharedContainer?.dispose();
    await disposeContainer();
  });

  test("should create container instance", () => {
    const container = new ApplicationContainer();
    expect(container).toBeDefined();
  });

  test("should initialize with configuration", () => {
    const settings = sharedContainer.getSettings();
    expect(settings).toBeDefined();
    expect(settings.appOptions.logLevel).toBe(LogLevel.ERROR);
    expect(settings.hassOptions.wsUrl).toBe(
      "ws://localhost:8123/api/websocket",
    );
  });

  test("should check service binding", () => {
    // Configuration services should be bound
    expect(sharedContainer.isBound(TYPES.Settings)).toBe(true);
    expect(sharedContainer.isBound(TYPES.HvacOptions)).toBe(true);
    expect(sharedContainer.isBound(TYPES.HassOptions)).toBe(true);
    expect(sharedContainer.isBound(TYPES.ApplicationOptions)).toBe(true);
    expect(sharedContainer.isBound(TYPES.Logger)).toBe(true);
  });

  test("should retrieve services", () => {
    const settings = sharedContainer.get(TYPES.Settings);
    expect(settings).toBeDefined();

    const hvacOptions = sharedContainer.get(TYPES.HvacOptions) as HvacOptions;
    expect(hvacOptions).toBeDefined();
    expect(hvacOptions.tempSensor).toBe("sensor.indoor_temp");

    const logger = sharedContainer.get(TYPES.Logger);
    expect(logger).toBeDefined();
  });

  test("should handle initialization errors", async () => {
    const container = new ApplicationContainer();

    await expect(
      container.initialize("nonexistent-config.yaml"),
    ).rejects.toThrow();
  });

  test("should dispose properly", async () => {
    const container = new ApplicationContainer();
    await container.initialize(testConfigPath);

    // Should not throw
    await expect(async () => await container.dispose()).not.toThrow();
  });
});

describe("Application Container - Service Registration", () => {
  beforeEach(() => {
    fs.writeFileSync(testConfigPath, mockConfigYaml);
  });

  afterEach(async () => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    await disposeContainer();
  });

  test("should register configuration services", async () => {
    const container = new ApplicationContainer();
    await container.initialize(testConfigPath);

    // All configuration should be registered
    const settings = container.get<Settings>(TYPES.Settings);
    const hvacOptions = container.get(TYPES.HvacOptions) as HvacOptions;
    const hassOptions = container.get(TYPES.HassOptions) as any;
    const appOptions = container.get(TYPES.ApplicationOptions) as any;

    expect(settings).toBeDefined();
    expect(hvacOptions).toBeDefined();
    expect(hassOptions).toBeDefined();
    expect(appOptions).toBeDefined();

    // Values should match loaded configuration
    expect(settings.hvacOptions).toBe(hvacOptions);
    expect(settings.hassOptions).toBe(hassOptions);
    expect(settings.appOptions).toBe(appOptions);
  });

  test("should register core services", async () => {
    const container = new ApplicationContainer();
    await container.initialize(testConfigPath);

    expect(container.isBound(TYPES.Logger)).toBe(true);
    expect(container.isBound(TYPES.ConfigLoader)).toBe(true);

    const logger = container.get(TYPES.Logger) as LoggerService;
    expect(logger).toBeDefined();

    // Logger should have expected methods
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warning).toBe("function");
  });

  test("should handle missing settings", () => {
    const container = new ApplicationContainer();

    expect(() => container.getSettings()).toThrow("Settings not loaded");
  });
});

describe("Application Container - Global Container Functions", () => {
  beforeEach(() => {
    setupTestLogging();
    fs.writeFileSync(testConfigPath, mockConfigYaml);
  });

  afterEach(async () => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    await disposeContainer();
  });

  test("should create global container", async () => {
    const container = await createContainer(testConfigPath);

    expect(container).toBeDefined();
    expect(container.getSettings().appOptions.logLevel).toBe(LogLevel.ERROR);
  });

  test("should get global container", async () => {
    await createContainer(testConfigPath);

    const container = getContainer();
    expect(container).toBeDefined();
    expect(container.getSettings().hassOptions.wsUrl).toBe(
      "ws://localhost:8123/api/websocket",
    );
  });

  test("should handle get container when not initialized", () => {
    expect(() => getContainer()).toThrow("Container not initialized");
  });

  test("should dispose and recreate global container", async () => {
    // Create first container
    const container1 = await createContainer(testConfigPath);
    expect(container1).toBeDefined();

    // Create second container (should dispose first)
    const container2 = await createContainer(testConfigPath);
    expect(container2).toBeDefined();

    // Should be able to get the new container
    const retrieved = getContainer();
    expect(retrieved).toBe(container2);
  });

  test("should handle dispose when no container", async () => {
    // Should not throw
    await expect(async () => await disposeContainer()).not.toThrow();
  });
});

describe("Application Container - Error Handling", () => {
  beforeEach(() => {
    fs.writeFileSync(testConfigPath, mockConfigYaml);
  });

  afterEach(async () => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    await disposeContainer();
  });

  test("should handle configuration loading errors", async () => {
    const container = new ApplicationContainer();

    await expect(container.initialize("invalid-config.yaml")).rejects.toThrow();
  });

  test("should handle service resolution errors gracefully", async () => {
    const container = new ApplicationContainer();
    await container.initialize(testConfigPath);

    // Try to get unregistered service
    expect(() => container.get(Symbol.for("NonexistentService"))).toThrow();
  });
});

describe("Application Container - Configuration Validation", () => {
  beforeEach(() => {
    fs.writeFileSync(testConfigPath, mockConfigYaml);
  });

  afterEach(async () => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    await disposeContainer();
  });

  test("should validate complete configuration", async () => {
    const container = new ApplicationContainer();
    await container.initialize(testConfigPath);

    const settings = container.getSettings();

    // All required sections should be present
    expect(settings.appOptions).toBeDefined();
    expect(settings.hassOptions).toBeDefined();
    expect(settings.hvacOptions).toBeDefined();

    // Key values should be correct
    expect(settings.hvacOptions.tempSensor).toBe("sensor.indoor_temp");
    expect(settings.hvacOptions.systemMode).toBe(SystemMode.AUTO);
    expect(settings.hassOptions.token).toBe("test_token");
  });
});
