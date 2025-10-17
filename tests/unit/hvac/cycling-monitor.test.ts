import { describe, test, expect, beforeEach } from "vitest";
import { CyclingMonitor } from "../../../src/hvac/cycling-monitor";
import { LoggerService } from "../../../src/core/logging";

describe("CyclingMonitor", () => {
  let monitor: CyclingMonitor;
  let mockLogger: LoggerService;

  beforeEach(() => {
    mockLogger = new LoggerService("test");
    monitor = new CyclingMonitor(mockLogger);
  });

  test("should detect normal cycling behavior", () => {
    // Simulate normal cycling: OFF -> HEAT -> OFF (30+ minutes apart)
    const baseTime = new Date("2024-01-01T09:00:00Z");

    // Mock Date.now for consistent testing
    const originalDateNow = Date.now;
    Date.now = () => baseTime.getTime();

    monitor.recordStateChange("OFF", "HEAT", 20.5);

    // Advance 30 minutes
    Date.now = () => baseTime.getTime() + 30 * 60 * 1000;
    monitor.recordStateChange("HEAT", "OFF", 21.3);

    const health = monitor.getHysteresisHealth();
    expect(health.status).toBe("HEALTHY");
    expect(health.message).toContain("Normal cycling");

    // Restore original Date.now
    Date.now = originalDateNow;
  });

  test("should detect rapid cycling", () => {
    const baseTime = new Date("2024-01-01T09:00:00Z");
    const originalDateNow = Date.now;

    // Simulate rapid cycling: OFF -> HEAT -> OFF -> HEAT (within 10 minutes)
    Date.now = () => baseTime.getTime();
    monitor.recordStateChange("OFF", "HEAT", 21.2);

    Date.now = () => baseTime.getTime() + 5 * 60 * 1000; // 5 minutes later
    monitor.recordStateChange("HEAT", "OFF", 21.3);

    Date.now = () => baseTime.getTime() + 10 * 60 * 1000; // 10 minutes total
    monitor.recordStateChange("OFF", "HEAT", 21.1);

    const health = monitor.getHysteresisHealth();
    expect(health.status).toBe("CRITICAL");
    expect(health.message).toContain("Rapid cycling");

    Date.now = originalDateNow;
  });

  test("should handle insufficient data gracefully", () => {
    const health = monitor.getHysteresisHealth();
    expect(health.status).toBe("INSUFFICIENT_DATA");
    expect(health.message).toContain("Need more state changes");
  });

  test("should track state changes with temperatures", () => {
    monitor.recordStateChange("OFF", "HEAT", 20.6);
    monitor.recordStateChange("HEAT", "OFF", 21.3);

    // Should not throw and should track the changes
    const health = monitor.getHysteresisHealth();
    expect(health.details.cyclesLast24h).toBe(1);
  });
});
