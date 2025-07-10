/**
 * Unit tests for core exceptions in HAG JavaScript variant.
 */

import { expect, test, describe } from "bun:test";
import {
  AIError,
  ConfigurationError,
  ConnectionError,
  extractErrorDetails,
  HAGError,
  HVACOperationError,
  isHAGError,
  StateError,
  ValidationError,
} from "../../../src/core/exceptions.ts";

describe("HAGError", () => {
  test("should create basic HAG error", () => {
    const error = new HAGError("Test error");
    expect(error.message).toBe("Test error");
    expect(error.name).toBe("HAGError");
    expect(error.code).toBeUndefined();
  });

  test("should create HAG error with code and cause", () => {
    const cause = new Error("Root cause");
    const error = new HAGError("Test error", "TEST_CODE", cause);
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.cause).toBe(cause);
  });
});

describe("ConfigurationError", () => {
  test("should create configuration error", () => {
    const error = new ConfigurationError("Config error");
    expect(error.message).toBe("Config error");
    expect(error.name).toBe("ConfigurationError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("ConnectionError", () => {
  test("should create connection error", () => {
    const error = new ConnectionError("Connection failed");
    expect(error.message).toBe("Connection failed");
    expect(error.name).toBe("ConnectionError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("ValidationError", () => {
  test("should create validation error", () => {
    const error = new ValidationError("Validation failed");
    expect(error.message).toBe("Validation failed");
    expect(error.name).toBe("ValidationError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("StateError", () => {
  test("should create state error", () => {
    const error = new StateError("State error");
    expect(error.message).toBe("State error");
    expect(error.name).toBe("StateError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("HVACOperationError", () => {
  test("should create HVAC operation error", () => {
    const error = new HVACOperationError("HVAC error");
    expect(error.message).toBe("HVAC error");
    expect(error.name).toBe("HVACOperationError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("AIError", () => {
  test("should create AI error", () => {
    const error = new AIError("AI error");
    expect(error.message).toBe("AI error");
    expect(error.name).toBe("AIError");
    expect(error).toBeInstanceOf(HAGError);
  });
});

describe("isHAGError", () => {
  test("should identify HAG errors", () => {
    const hagError = new HAGError("Test");
    const configError = new ConfigurationError("Config");
    const regularError = new Error("Regular");

    expect(isHAGError(hagError)).toBe(true);
    expect(isHAGError(configError)).toBe(true);
    expect(isHAGError(regularError)).toBe(false);
    expect(isHAGError(null)).toBe(false);
    expect(isHAGError(undefined)).toBe(false);
  });
});

describe("extractErrorDetails", () => {
  test("should extract details from HAG error", () => {
    const error = new HAGError("Test error", "TEST_CODE");
    const details = extractErrorDetails(error);

    expect(details.message).toBe("Test error");
    expect(details.name).toBe("HAGError");
    expect(details.code).toBe("TEST_CODE");
    expect(details.stack).toBeDefined();
  });

  test("should extract details from regular error", () => {
    const error = new Error("Regular error");
    const details = extractErrorDetails(error);

    expect(details.message).toBe("Regular error");
    expect(details.name).toBe("Error");
    expect(details.code).toBeUndefined();
    expect(details.stack).toBeDefined();
  });

  test("should handle non-error values", () => {
    const details1 = extractErrorDetails("String error");
    expect(details1.message).toBe("String error");
    expect(details1.name).toBe("UnknownError");
    expect(details1.code).toBeUndefined();
    expect(details1.stack).toBeUndefined();

    const details2 = extractErrorDetails(null);
    expect(details2.message).toBe("null");
    expect(details2.name).toBe("UnknownError");

    const details3 = extractErrorDetails({ custom: "object" });
    expect(details3.message).toBe("[object Object]");
    expect(details3.name).toBe("UnknownError");
  });
});
