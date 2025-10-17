import { Logger } from "../core/logging";

interface StateChange {
  timestamp: Date;
  fromState: string;
  toState: string;
  temperature: number;
}

export class CyclingMonitor {
  private stateChanges: StateChange[] = [];
  private readonly maxHistorySize = 100;
  private readonly rapidCycleThresholdMinutes = 15; // Alert if cycles faster than this

  constructor(private logger: Logger) {}

  recordStateChange(
    fromState: string,
    toState: string,
    temperature: number,
  ): void {
    const change: StateChange = {
      timestamp: new Date(),
      fromState,
      toState,
      temperature,
    };

    this.stateChanges.push(change);

    // Keep only recent history
    if (this.stateChanges.length > this.maxHistorySize) {
      this.stateChanges.shift();
    }

    this.detectRapidCycling();
  }

  private detectRapidCycling(): void {
    if (this.stateChanges.length < 3) return;

    const recent = this.stateChanges.slice(-3);

    // Check for HEAT -> OFF -> HEAT pattern within threshold
    if (
      recent[0].toState === "HEAT" &&
      recent[1].toState === "OFF" &&
      recent[2].toState === "HEAT"
    ) {
      const cycleDuration =
        recent[2].timestamp.getTime() - recent[0].timestamp.getTime();
      const cycleMinutes = cycleDuration / (1000 * 60);

      if (cycleMinutes < this.rapidCycleThresholdMinutes) {
        this.logger.warning("🚨 RAPID CYCLING DETECTED", {
          cyclePattern: `${recent[0].fromState}→HEAT→OFF→HEAT`,
          cycleDuration: `${cycleMinutes.toFixed(1)} minutes`,
          threshold: `${this.rapidCycleThresholdMinutes} minutes`,
          temperatures: recent.map((c) => `${c.temperature}°C`).join(" → "),
          timestamps: recent.map((c) => c.timestamp.toISOString()).join(" → "),
          severity: cycleMinutes < 5 ? "CRITICAL" : "WARNING",
        });
      }
    }
  }

  getHysteresisHealth(): { status: string; message: string; details: any } {
    if (this.stateChanges.length < 2) {
      return {
        status: "INSUFFICIENT_DATA",
        message: "Need more state changes to analyze",
        details: {},
      };
    }

    const last24Hours = this.stateChanges.filter(
      (change) => Date.now() - change.timestamp.getTime() < 24 * 60 * 60 * 1000,
    );

    const heatCycles = last24Hours.filter((c) => c.toState === "HEAT").length;

    // Calculate average time between cycles more accurately
    const heatTransitions = last24Hours.filter((c) => c.toState === "HEAT");
    let avgCycleTime = Infinity;

    if (heatTransitions.length > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < heatTransitions.length; i++) {
        const interval =
          heatTransitions[i].timestamp.getTime() -
          heatTransitions[i - 1].timestamp.getTime();
        intervals.push(interval);
      }
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      avgCycleTime = avgInterval / (1000 * 60); // Convert to minutes
    }

    let status = "HEALTHY";
    let message = "Normal cycling behavior detected";

    if (avgCycleTime < 15 && avgCycleTime !== Infinity) {
      status = "CRITICAL";
      message = "Rapid cycling detected - system may be damaged";
    } else if (avgCycleTime < 30 && avgCycleTime !== Infinity) {
      status = "WARNING";
      message = "Frequent cycling - check hysteresis configuration";
    } else if (avgCycleTime > 120 && avgCycleTime !== Infinity) {
      status = "INFO";
      message = "Excellent cycling stability";
    }

    return {
      status,
      message,
      details: {
        cyclesLast24h: heatCycles,
        averageCycleTimeMinutes:
          avgCycleTime === Infinity ? "N/A" : avgCycleTime.toFixed(1),
        lastStateChange:
          this.stateChanges[
            this.stateChanges.length - 1
          ]?.timestamp?.toISOString(),
        rapidCycleThreshold: `${this.rapidCycleThresholdMinutes} minutes`,
      },
    };
  }

  logHealthStatus(): void {
    const health = this.getHysteresisHealth();

    if (health.status === "CRITICAL") {
      this.logger.error(`📊 Hysteresis Health: ${health.status}`, undefined, {
        message: health.message,
        ...health.details,
      });
    } else if (health.status === "WARNING") {
      this.logger.warning(`📊 Hysteresis Health: ${health.status}`, {
        message: health.message,
        ...health.details,
      });
    } else {
      this.logger.info(`📊 Hysteresis Health: ${health.status}`, {
        message: health.message,
        ...health.details,
      });
    }
  }
}
