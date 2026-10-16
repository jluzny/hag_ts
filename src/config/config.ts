/**
 * Configuration settings for HAG JavaScript variant using Zod.
 *
 * Type-safe configuration schemas with validation.
 */

import { z } from "zod";
import { LogLevel, SystemMode } from "../types/common.ts";

/**
 * Home Assistant connection options schema
 */
export const HassOptionsSchema = z.object({
  wsUrl: z.string().url().describe("WebSocket URL for Home Assistant"),
  restUrl: z.string().url().describe("REST API URL for Home Assistant"),
  token: z.string().min(1).describe("Long-lived access token"),
  maxRetries: z
    .number()
    .int()
    .positive()
    .describe("Maximum connection retry attempts"),
  retryDelayMs: z
    .number()
    .int()
    .positive()
    .describe("Delay between retries in milliseconds"),
  stateCheckInterval: z
    .number()
    .int()
    .positive()
    .describe("State check interval in milliseconds"),
  stateRequestTimeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional bound in milliseconds for a single REST state read (default 5000). A hung state read must not block HVAC command batches.",
    ),
});

/**
 * Temperature calibration configuration schema
 */
export const TemperatureCalibrationSchema = z.record(
  z.string().describe("Sensor entity ID"),
  z
    .number()
    .min(-5.0)
    .max(5.0)
    .describe("Temperature offset in Celsius (-5.0 to +5.0)"),
).describe("Temperature calibration offsets for sensors");

/**
 * Temperature threshold configuration schema
 */
export const TemperatureThresholdsSchema = z
  .object({
    indoorMin: z
      .number()
      .min(-50)
      .max(60)
      .describe("Minimum indoor temperature"),
    indoorMax: z
      .number()
      .min(-50)
      .max(60)
      .describe("Maximum indoor temperature"),
    outdoorMin: z
      .number()
      .min(-50)
      .max(60)
      .describe("Minimum outdoor temperature for operation"),
    outdoorMax: z
      .number()
      .min(-50)
      .max(60)
      .describe("Maximum outdoor temperature for operation"),
  })
  .refine((data) => data.indoorMin < data.indoorMax, {
    message: "Indoor min temperature must be less than max temperature",
    path: ["indoorMin"],
  })
  .refine((data) => data.outdoorMin < data.outdoorMax, {
    message: "Outdoor min temperature must be less than max temperature",
    path: ["outdoorMin"],
  });

/**
 * Defrost cycle configuration schema
 */
export const DefrostOptionsSchema = z.object({
  temperatureThreshold: z
    .number()
    .describe("Temperature below which defrost is needed"),
  periodSeconds: z
    .number()
    .int()
    .positive()
    .describe("Defrost cycle period in seconds"),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .describe("Defrost cycle duration in seconds"),
});

/**
 * Outdoor temperature condition schema for heating rules.
 * All comparison fields are optional; absence means no constraint on that side.
 */
export const OutdoorTempConditionSchema = z.object({
  gt: z.number().min(-50).max(60).optional().describe("Outdoor temp must be strictly greater than"),
  gte: z.number().min(-50).max(60).optional().describe("Outdoor temp must be >="),
  lt: z.number().min(-50).max(60).optional().describe("Outdoor temp must be strictly less than"),
  lte: z.number().min(-50).max(60).optional().describe("Outdoor temp must be <="),
});

/**
 * Actions to apply when a heating rule matches.
 */
export const HeatingRuleActionsSchema = z.object({
  includeUnits: z
    .array(z.string().refine((val) => val.includes("."), {
      message: 'Entity ID must be in format "domain.entity"',
    }))
    .min(1)
    .describe("Entity IDs to start when rule matches"),
});

/**
 * Single heating rule: first matching rule wins.
 */
export const HeatingRuleSchema = z.object({
  conditions: z.object({
    outdoorTemp: OutdoorTempConditionSchema.optional(),
  }).passthrough(),
  actions: HeatingRuleActionsSchema,
});

/**
 * Heating configuration schema
 */
export const HeatingOptionsSchema = z.object({
  temperature: z
    .number()
    .min(10)
    .max(35)
    .describe("Target heating temperature"),
  presetMode: z.string().describe("Heating preset mode"),
  temperatureThresholds: TemperatureThresholdsSchema,
  defrost: DefrostOptionsSchema.optional().describe("Defrost configuration"),
  rules: z
    .array(HeatingRuleSchema)
    .optional()
    .describe(
      "Ordered rules — first rule whose conditions all match wins; no match = all enabled entities",
    ),
});

/**
 * Cooling configuration schema
 */
export const CoolingOptionsSchema = z.object({
  temperature: z
    .number()
    .min(15)
    .max(35)
    .describe("Target cooling temperature"),
  presetMode: z.string().describe("Cooling preset mode"),
  temperatureThresholds: TemperatureThresholdsSchema,
});

/**
 * Active hours configuration schema
 */
export const ActiveHoursSchema = z.object({
  start: z.number().int().min(0).max(23).describe("Start hour (24h format)"),
  startWeekday: z.number().int().min(0).max(23).describe("Weekday start hour"),
  end: z.number().int().min(0).max(23).describe("End hour (24h format)"),
});

/**
 * HVAC entity configuration schema
 */
export const HvacEntitySchema = z.object({
  entityId: z
    .string()
    .refine((val) => val.includes("."), {
      message: 'Entity ID must be in format "domain.entity"',
    })
    .describe("Home Assistant entity ID"),
  enabled: z.boolean().describe("Whether entity is enabled"),
  defrost: z.boolean().describe("Whether entity supports defrost"),
  temperatureCorrection: z
    .number()
    .min(-5.0)
    .max(5.0)
    .optional()
    .describe(
      "Temperature correction in Celsius applied to heating target (-5.0 to +5.0)",
    ),
});

/**
 * Sensor failure detection / degraded-mode timing (issue 2).
 *
 * `reportTimeoutMs` is the approved initial silent-reporting timeout (30
 * minutes). Freshness comes from Home Assistant's own report timestamp
 * (`last_reported`), so an unchanged-but-reporting sensor is not a fault.
 */
export const SensorHealthOptionsSchema = z
  .object({
    reportTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(30 * 60 * 1000)
      .describe(
        "Milliseconds without a confirmed sensor report before the sensor is treated as failed (approved initial value: 30 minutes; adjust from measured reporting behaviour).",
      ),
    dailyReminderHours: z
      .number()
      .positive()
      .default(24)
      .describe(
        "Hours between repeat reminders while a sensor fault persists (one reminder per interval, never per evaluation).",
      ),
    notificationGraceMinutes: z
      .number()
      .min(0)
      .default(60)
      .describe(
        "Approved notification debounce: minutes a fault episode (hall sensor, outdoor sensor or the Home Assistant connection) must persist continuously after detection before the initial alert is sent. Detection, logging and degraded mode stay immediate; an episode that resolves inside the window sends neither a fault nor a recovery message. 0 disables the debounce (alert immediately).",
      ),
  })
  .optional()
  .describe("Hall/outdoor sensor failure detection and alert timing");

/**
 * Degraded-mode alert transport (issue 2). Alerts go through the Hermes
 * home-assistant profile's Telegram route; disabled unless a deployment
 * explicitly enables it and supplies the bot token for the configured chat.
 * Alert delivery failure must never affect HVAC control.
 */
export const AlertOptionsSchema = z
  .object({
    telegram: z
      .object({
        enabled: z
          .boolean()
          .default(false)
          .describe(
            "Enable Telegram alert delivery. Offline tests and unconfigured deployments stay silent.",
          ),
        botToken: z
          .string()
          .optional()
          .describe(
            "Telegram bot token of the Hermes home-assistant profile route (supply via environment, never commit).",
          ),
        chatId: z
          .string()
          .optional()
          .describe("Allowed chat id of the Hermes home-assistant profile route."),
      })
      .optional(),
  })
  .optional()
  .describe("Degraded-mode alert transport configuration");

/**
 * HVAC system configuration schema
 */
export const HvacOptionsSchema = z.object({
  tempSensor: z
    .string()
    .refine((val) => val.startsWith("sensor."), {
      message: "Temperature sensor must be a sensor entity",
    })
    .describe("Temperature sensor entity ID"),
  outdoorSensor: z
    .string()
    .refine((val) => val.startsWith("sensor."), {
      message: "Outdoor sensor must be a sensor entity",
    })
    .describe("Outdoor temperature sensor"),
  systemMode: z.nativeEnum(SystemMode).describe("System operation mode"),
  hvacEntities: z.array(HvacEntitySchema).describe("HVAC entities to control"),
  heating: HeatingOptionsSchema,
  cooling: CoolingOptionsSchema,
  activeHours: ActiveHoursSchema.optional().describe(
    "Active hours configuration",
  ),
  evaluationCacheMs: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .default(100)
    .describe("Cache duration for HVAC condition evaluations in milliseconds"),
  temperatureCalibration: TemperatureCalibrationSchema.optional().describe(
    "Temperature calibration offsets for sensors",
  ),
  sensorStalenessMs: z
    .number()
    .int()
    .min(0)
    .default(30 * 60 * 1000)
    .describe(
      "Max age in ms for per-unit sensor readings. Readings older than this are considered stale and replaced by the hall sensor value.",
    ),
  sensorHealth: SensorHealthOptionsSchema,
  alerts: AlertOptionsSchema,
});

/**
 * Experimental features configuration schema
 */
export const ExperimentalFeaturesSchema = z.object({
  adaptiveLearning: z.object({
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  advancedAnalytics: z
    .object({
      enabled: z.boolean(),
      config: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  predictiveModeling: z
    .object({
      enabled: z.boolean(),
      config: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

/**
 * Application-level configuration schema
 */
export const ApplicationOptionsSchema = z.object({
  logLevel: z.nativeEnum(LogLevel).describe("Logging level"),
  useAi: z.boolean().describe("Enable AI agent for HVAC decisions"),
  aiModel: z.string().describe("AI model to use"),
  aiTemperature: z.number().min(0).max(2).describe("AI model temperature"),
  openaiApiKey: z.string().optional().describe("OpenAI API key for AI agent"),
  experimentalFeatures: z
    .union([z.array(z.string()), ExperimentalFeaturesSchema])
    .optional()
    .describe(
      "Experimental features configuration (legacy string array or structured config)",
    ),
});

/**
 * Main application settings schema
 */
export const SettingsSchema = z.object({
  appOptions: ApplicationOptionsSchema,
  hassOptions: HassOptionsSchema,
  hvacOptions: HvacOptionsSchema,
});

// Re-export enum types for convenience
export { LogLevel, SystemMode } from "../types/common.ts";

// Export types inferred from schemas
export type HassOptions = z.infer<typeof HassOptionsSchema>;
export type TemperatureThresholds = z.infer<typeof TemperatureThresholdsSchema>;
export type DefrostOptions = z.infer<typeof DefrostOptionsSchema>;
export type HeatingOptions = z.infer<typeof HeatingOptionsSchema>;
export type CoolingOptions = z.infer<typeof CoolingOptionsSchema>;
export type ActiveHours = z.infer<typeof ActiveHoursSchema>;
export type HvacEntity = z.infer<typeof HvacEntitySchema>;
export type HvacOptions = z.infer<typeof HvacOptionsSchema>;
export type SensorHealthOptions = z.infer<typeof SensorHealthOptionsSchema>;
export type AlertOptions = z.infer<typeof AlertOptionsSchema>;
export type ApplicationOptions = z.infer<typeof ApplicationOptionsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

// Heating rules types
export type OutdoorTempCondition = z.infer<typeof OutdoorTempConditionSchema>;
export type HeatingRuleActions = z.infer<typeof HeatingRuleActionsSchema>;
export type HeatingRule = z.infer<typeof HeatingRuleSchema>;
