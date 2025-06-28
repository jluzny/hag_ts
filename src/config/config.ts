/**
 * Configuration settings for HAG JavaScript variant using Zod.
 * 
 * Type-safe configuration schemas with validation.
 */

import { z } from 'zod';
import { SystemMode, LogLevel } from '../types/common.ts';

/**
 * Home Assistant connection options schema
 */
export const HassOptionsSchema = z.object({
  wsUrl: z.string().url().describe('WebSocket URL for Home Assistant'),
  restUrl: z.string().url().describe('REST API URL for Home Assistant'),
  token: z.string().min(1).describe('Long-lived access token'),
  maxRetries: z.number().int().positive().default(5).describe('Maximum connection retry attempts'),
  retryDelayMs: z.number().int().positive().default(1000).describe('Delay between retries in milliseconds'),
  stateCheckInterval: z.number().int().positive().default(300000).describe('State check interval in milliseconds'),
});

/**
 * Temperature threshold configuration schema
 */
export const TemperatureThresholdsSchema = z.object({
  indoorMin: z.number().min(-50).max(60).describe('Minimum indoor temperature'),
  indoorMax: z.number().min(-50).max(60).describe('Maximum indoor temperature'),
  outdoorMin: z.number().min(-50).max(60).describe('Minimum outdoor temperature for operation'),
  outdoorMax: z.number().min(-50).max(60).describe('Maximum outdoor temperature for operation'),
}).refine((data) => data.indoorMin < data.indoorMax, {
  message: 'Indoor min temperature must be less than max temperature',
  path: ['indoorMin'],
}).refine((data) => data.outdoorMin < data.outdoorMax, {
  message: 'Outdoor min temperature must be less than max temperature',
  path: ['outdoorMin'],
});

/**
 * Defrost cycle configuration schema
 */
export const DefrostOptionsSchema = z.object({
  temperatureThreshold: z.number().default(0.0).describe('Temperature below which defrost is needed'),
  periodSeconds: z.number().int().positive().default(3600).describe('Defrost cycle period in seconds'),
  durationSeconds: z.number().int().positive().default(300).describe('Defrost cycle duration in seconds'),
});

/**
 * Heating configuration schema
 */
export const HeatingOptionsSchema = z.object({
  temperature: z.number().min(10).max(35).default(21.0).describe('Target heating temperature'),
  presetMode: z.string().default('comfort').describe('Heating preset mode'),
  temperatureThresholds: TemperatureThresholdsSchema,
  defrost: DefrostOptionsSchema.optional().describe('Defrost configuration'),
});

/**
 * Cooling configuration schema
 */
export const CoolingOptionsSchema = z.object({
  temperature: z.number().min(15).max(35).default(24.0).describe('Target cooling temperature'),
  presetMode: z.string().default('eco').describe('Cooling preset mode'),
  temperatureThresholds: TemperatureThresholdsSchema,
});

/**
 * Active hours configuration schema
 */
export const ActiveHoursSchema = z.object({
  start: z.number().int().min(0).max(23).default(8).describe('Start hour (24h format)'),
  startWeekday: z.number().int().min(0).max(23).default(7).describe('Weekday start hour'),
  end: z.number().int().min(0).max(23).default(22).describe('End hour (24h format)'),
});

/**
 * HVAC entity configuration schema
 */
export const HvacEntitySchema = z.object({
  entityId: z.string().refine((val) => val.includes('.'), {
    message: 'Entity ID must be in format "domain.entity"',
  }).describe('Home Assistant entity ID'),
  enabled: z.boolean().default(true).describe('Whether entity is enabled'),
  defrost: z.boolean().default(false).describe('Whether entity supports defrost'),
});

/**
 * HVAC system configuration schema
 */
export const HvacOptionsSchema = z.object({
  tempSensor: z.string().refine((val) => val.startsWith('sensor.'), {
    message: 'Temperature sensor must be a sensor entity',
  }).describe('Temperature sensor entity ID'),
  outdoorSensor: z.string().refine((val) => val.startsWith('sensor.'), {
    message: 'Outdoor sensor must be a sensor entity',
  }).default('sensor.openweathermap_temperature').describe('Outdoor temperature sensor'),
  systemMode: z.nativeEnum(SystemMode).default(SystemMode.AUTO).describe('System operation mode'),
  hvacEntities: z.array(HvacEntitySchema).default([]).describe('HVAC entities to control'),
  heating: HeatingOptionsSchema,
  cooling: CoolingOptionsSchema,
  activeHours: ActiveHoursSchema.optional().describe('Active hours configuration'),
});

/**
 * Application-level configuration schema
 */
export const ApplicationOptionsSchema = z.object({
  logLevel: z.nativeEnum(LogLevel).default(LogLevel.DEBUG).describe('Logging level'),
  useAi: z.boolean().default(false).describe('Enable AI agent for HVAC decisions'),
  aiModel: z.string().default('gpt-4o-mini').describe('AI model to use'),
  aiTemperature: z.number().min(0).max(2).default(0.1).describe('AI model temperature'),
  openaiApiKey: z.string().optional().describe('OpenAI API key for AI agent'),
  dryRun: z.boolean().default(false).describe('Enable dry run mode (no actual HA calls)'),
});

/**
 * Main application settings schema
 */
export const SettingsSchema = z.object({
  appOptions: ApplicationOptionsSchema.default({}),
  hassOptions: HassOptionsSchema,
  hvacOptions: HvacOptionsSchema,
});

// Re-export enum types for convenience
export { SystemMode, LogLevel } from '../types/common.ts';

// Export types inferred from schemas
export type HassOptions = z.infer<typeof HassOptionsSchema>;
export type TemperatureThresholds = z.infer<typeof TemperatureThresholdsSchema>;
export type DefrostOptions = z.infer<typeof DefrostOptionsSchema>;
export type HeatingOptions = z.infer<typeof HeatingOptionsSchema>;
export type CoolingOptions = z.infer<typeof CoolingOptionsSchema>;
export type ActiveHours = z.infer<typeof ActiveHoursSchema>;
export type HvacEntity = z.infer<typeof HvacEntitySchema>;
export type HvacOptions = z.infer<typeof HvacOptionsSchema>;
export type ApplicationOptions = z.infer<typeof ApplicationOptionsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

