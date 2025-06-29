/**
 * Smart Scheduler for Advanced HVAC Automation
 * 
 * This module implements intelligent scheduling and automation features
 * that leverage AI optimization, predictive analytics, and adaptive learning.
 */

import { ScheduleItem, EnergyOptimizationResult, HVACDecisionContext } from '../types/ai-types.ts';
import { HVACOptimizer } from '../optimization/hvac-optimizer.ts';
import { PredictiveAnalyticsEngine } from '../predictive/analytics-engine.ts';
import { AdaptiveLearningEngine } from '../learning/adaptive-learning-engine.ts';
import { SystemMode } from '../../types/common.ts';
import type { LoggerService } from '../../core/logger.ts';

/**
 * Schedule rule configuration
 */
export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // 1-10, higher = more important
  
  // Trigger conditions
  triggers: {
    timeOfDay?: { start: number; end: number }; // Hours
    daysOfWeek?: number[]; // 0-6, Sunday = 0
    seasonalConditions?: {
      minOutdoorTemp?: number;
      maxOutdoorTemp?: number;
      weatherConditions?: string[];
    };
    occupancyPattern?: 'present' | 'away' | 'sleeping';
    energyPricing?: 'peak' | 'off-peak' | 'shoulder';
  };
  
  // Actions to take
  actions: {
    targetTemperature?: number;
    systemMode?: SystemMode;
    maxEnergyBudget?: number; // kWh
    comfortPriority?: number; // 0.0 to 1.0
    responsiveness?: 'immediate' | 'gradual' | 'delayed';
  };
  
  // Automation settings
  automation: {
    preConditioning?: {
      enabled: boolean;
      minutesBefore: number;
    };
    adaptToWeather?: boolean;
    learnFromUser?: boolean;
    overridable?: boolean;
  };
}

/**
 * Automation event
 */
export interface AutomationEvent {
  id: string;
  timestamp: Date;
  eventType: 'schedule_trigger' | 'weather_change' | 'occupancy_change' | 'energy_price_change' | 'user_override';
  ruleId?: string;
  context: HVACDecisionContext;
  action: {
    type: 'temperature_change' | 'mode_change' | 'system_optimization' | 'preconditioning';
    details: Record<string, any>;
    reason: string;
  };
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  result?: {
    success: boolean;
    energyUsed?: number;
    comfortAchieved?: number;
    executionTime?: number;
  };
}

/**
 * Scheduling configuration
 */
export interface SchedulingConfig {
  // Scheduling behavior
  defaultLookaheadHours: number;
  maxConcurrentEvents: number;
  eventConflictResolution: 'priority' | 'merge' | 'defer';
  
  // Automation settings
  autoOptimizationInterval: number; // Minutes
  weatherUpdateInterval: number; // Minutes
  occupancyDetectionEnabled: boolean;
  
  // Learning integration
  adaptScheduleFromLearning: boolean;
  learningInfluenceWeight: number; // 0.0 to 1.0
  
  // Safety limits
  maxTempChange: number; // Max °C change per hour
  minComfortScore: number; // Minimum acceptable comfort
  emergencyOverrideEnabled: boolean;
}

/**
 * Smart Scheduler Engine
 */
export class SmartScheduler {
  private config: SchedulingConfig;
  private logger: LoggerService;
  
  // AI components
  private optimizer?: HVACOptimizer;
  private analytics?: PredictiveAnalyticsEngine;
  private learning?: AdaptiveLearningEngine;
  
  // Scheduling data
  private scheduleRules: Map<string, ScheduleRule> = new Map();
  private activeEvents: Map<string, AutomationEvent> = new Map();
  private eventHistory: AutomationEvent[] = [];
  
  // Timers and intervals
  private schedulerInterval?: number;
  private optimizationInterval?: number;
  private weatherInterval?: number;
  
  // Current state
  private isRunning: boolean = false;
  private currentSchedule: ScheduleItem[] = [];
  
  constructor(
    config: SchedulingConfig,
    logger: LoggerService,
    optimizer?: HVACOptimizer,
    analytics?: PredictiveAnalyticsEngine,
    learning?: AdaptiveLearningEngine
  ) {
    this.config = config;
    this.logger = logger;
    this.optimizer = optimizer;
    this.analytics = analytics;
    this.learning = learning;
    
    this.logger.info('🗓️ [Smart Scheduler] Initialized', {
      lookaheadHours: config.defaultLookaheadHours,
      autoOptimization: config.autoOptimizationInterval,
      aiIntegrations: {
        optimizer: !!optimizer,
        analytics: !!analytics,
        learning: !!learning
      }
    });
  }
  
  /**
   * Start the smart scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warning('🔄 [Smart Scheduler] Already running');
      return;
    }
    
    try {
      this.isRunning = true;
      
      // Load default scheduling rules
      await this.loadDefaultRules();
      
      // Generate initial schedule
      await this.generateSchedule();
      
      // Start periodic processes
      this.startPeriodicProcesses();
      
      this.logger.info('🚀 [Smart Scheduler] Started successfully', {
        rules: this.scheduleRules.size,
        activeEvents: this.activeEvents.size,
        scheduleItems: this.currentSchedule.length
      });
      
    } catch (error) {
      this.logger.error('❌ [Smart Scheduler] Failed to start', error);
      this.isRunning = false;
      throw error;
    }
  }
  
  /**
   * Stop the smart scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('🛑 [Smart Scheduler] Stopping', {
      activeEvents: this.activeEvents.size,
      completedEvents: this.eventHistory.length
    });
    
    this.isRunning = false;
    
    // Clear intervals
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    if (this.optimizationInterval) clearInterval(this.optimizationInterval);
    if (this.weatherInterval) clearInterval(this.weatherInterval);
    
    // Cancel pending events
    for (const event of this.activeEvents.values()) {
      if (event.status === 'pending') {
        event.status = 'cancelled';
        event.result = { success: false };
      }
    }
  }
  
  /**
   * Add a scheduling rule
   */
  addScheduleRule(rule: ScheduleRule): void {
    this.scheduleRules.set(rule.id, rule);
    
    this.logger.info('📋 [Smart Scheduler] Rule added', {
      ruleId: rule.id,
      name: rule.name,
      priority: rule.priority,
      enabled: rule.enabled
    });
    
    // Regenerate schedule if running
    if (this.isRunning) {
      this.generateSchedule();
    }
  }
  
  /**
   * Remove a scheduling rule
   */
  removeScheduleRule(ruleId: string): boolean {
    const removed = this.scheduleRules.delete(ruleId);
    
    if (removed) {
      this.logger.info('🗑️ [Smart Scheduler] Rule removed', { ruleId });
      
      // Regenerate schedule if running
      if (this.isRunning) {
        this.generateSchedule();
      }
    }
    
    return removed;
  }
  
  /**
   * Update a scheduling rule
   */
  updateScheduleRule(ruleId: string, updates: Partial<ScheduleRule>): boolean {
    const rule = this.scheduleRules.get(ruleId);
    if (!rule) {
      return false;
    }
    
    const updatedRule = { ...rule, ...updates };
    this.scheduleRules.set(ruleId, updatedRule);
    
    this.logger.info('🔧 [Smart Scheduler] Rule updated', {
      ruleId,
      changes: Object.keys(updates)
    });
    
    // Regenerate schedule if running
    if (this.isRunning) {
      this.generateSchedule();
    }
    
    return true;
  }
  
  /**
   * Generate optimized schedule for the next period
   */
  async generateSchedule(horizonHours: number = this.config.defaultLookaheadHours): Promise<ScheduleItem[]> {
    this.logger.debug('📅 [Smart Scheduler] Generating schedule', {
      horizonHours,
      activeRules: Array.from(this.scheduleRules.values()).filter(r => r.enabled).length
    });
    
    try {
      const schedule: ScheduleItem[] = [];
      const now = new Date();
      
      // Get personalized recommendations if learning is available
      let personalizedWeights;
      if (this.learning) {
        const context = await this.getCurrentContext();
        const recommendations = await this.learning.getPersonalizedRecommendations(context);
        personalizedWeights = recommendations.optimizationWeights;
      }
      
      // Generate hourly schedule items
      for (let hour = 0; hour < horizonHours; hour++) {
        const timeSlot = new Date(now.getTime() + hour * 60 * 60 * 1000);
        
        // Find applicable rules for this time slot
        const applicableRules = this.findApplicableRules(timeSlot);
        
        // Get weather predictions if available
        let weatherContext;
        if (this.analytics) {
          try {
            const tempPrediction = await this.analytics.predictIndoorTemperature(hour);
            weatherContext = {
              predictedIndoorTemp: tempPrediction.predictedValue,
              confidence: tempPrediction.confidence
            };
          } catch (error) {
            this.logger.debug('⚠️ [Smart Scheduler] Weather prediction failed', error);
          }
        }
        
        // Create schedule item
        const scheduleItem = await this.createScheduleItem(timeSlot, applicableRules, weatherContext, personalizedWeights);
        schedule.push(scheduleItem);
      }
      
      // Optimize schedule using AI optimizer if available
      if (this.optimizer && schedule.length > 0) {
        schedule.forEach(async (item, index) => {
          try {
            const context = await this.createOptimizationContext(item, schedule[index - 1]);
            const optimized = await this.optimizer!.optimizeDecision(context);
            
            // Apply optimization results
            if (optimized.targetTemp) {
              item.targetTemp = optimized.targetTemp;
            }
            if (optimized.predictedEnergyUse) {
              item.energyBudget = optimized.predictedEnergyUse;
            }
          } catch (error) {
            this.logger.debug('⚠️ [Smart Scheduler] Optimization failed for item', error);
          }
        });
      }
      
      this.currentSchedule = schedule;
      
      this.logger.info('✅ [Smart Scheduler] Schedule generated', {
        items: schedule.length,
        averageTargetTemp: this.calculateAverageTargetTemp(schedule),
        totalEnergyBudget: this.calculateTotalEnergyBudget(schedule)
      });
      
      return schedule;
      
    } catch (error) {
      this.logger.error('❌ [Smart Scheduler] Schedule generation failed', error);
      return this.currentSchedule; // Return current schedule as fallback
    }
  }
  
  /**
   * Trigger immediate automation based on context change
   */
  async triggerAutomation(
    eventType: AutomationEvent['eventType'],
    context: HVACDecisionContext,
    reason: string
  ): Promise<AutomationEvent | null> {
    
    if (!this.isRunning) {
      return null;
    }
    
    this.logger.debug('⚡ [Smart Scheduler] Triggering automation', {
      eventType,
      reason,
      context: {
        indoorTemp: context.indoorTemp,
        outdoorTemp: context.outdoorTemp,
        currentHour: context.currentHour
      }
    });
    
    try {
      // Find applicable rules for immediate execution
      const applicableRules = this.findApplicableRules(new Date(), context);
      
      if (applicableRules.length === 0) {
        this.logger.debug('ℹ️ [Smart Scheduler] No applicable rules for automation trigger');
        return null;
      }
      
      // Select highest priority rule
      const selectedRule = applicableRules.sort((a, b) => b.priority - a.priority)[0];
      
      // Create automation event
      const event: AutomationEvent = {
        id: `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        eventType,
        ruleId: selectedRule.id,
        context,
        action: {
          type: this.determineActionType(selectedRule),
          details: selectedRule.actions,
          reason
        },
        status: 'pending'
      };
      
      // Execute automation
      await this.executeAutomationEvent(event);
      
      return event;
      
    } catch (error) {
      this.logger.error('❌ [Smart Scheduler] Automation trigger failed', error);
      return null;
    }
  }
  
  /**
   * Get current schedule status
   */
  getScheduleStatus(): {
    isRunning: boolean;
    scheduleItems: number;
    activeEvents: number;
    totalRules: number;
    enabledRules: number;
    nextScheduledItem?: ScheduleItem;
    recentEvents: AutomationEvent[];
  } {
    const enabledRules = Array.from(this.scheduleRules.values()).filter(r => r.enabled);
    const now = new Date();
    const nextItem = this.currentSchedule.find(item => item.startTime > now);
    const recentEvents = this.eventHistory.slice(-10); // Last 10 events
    
    return {
      isRunning: this.isRunning,
      scheduleItems: this.currentSchedule.length,
      activeEvents: this.activeEvents.size,
      totalRules: this.scheduleRules.size,
      enabledRules: enabledRules.length,
      nextScheduledItem: nextItem,
      recentEvents
    };
  }
  
  /**
   * Load default scheduling rules
   */
  private async loadDefaultRules(): Promise<void> {
    const defaultRules: ScheduleRule[] = [
      {
        id: 'morning_warmup',
        name: 'Morning Warmup',
        enabled: true,
        priority: 8,
        triggers: {
          timeOfDay: { start: 6, end: 9 },
          daysOfWeek: [1, 2, 3, 4, 5], // Weekdays
        },
        actions: {
          targetTemperature: 22,
          comfortPriority: 0.8,
          responsiveness: 'gradual'
        },
        automation: {
          preConditioning: {
            enabled: true,
            minutesBefore: 30
          },
          adaptToWeather: true,
          learnFromUser: true,
          overridable: true
        }
      },
      {
        id: 'energy_saving_night',
        name: 'Energy Saving Night',
        enabled: true,
        priority: 6,
        triggers: {
          timeOfDay: { start: 22, end: 6 },
        },
        actions: {
          targetTemperature: 20,
          maxEnergyBudget: 1.0,
          comfortPriority: 0.4,
          responsiveness: 'gradual'
        },
        automation: {
          adaptToWeather: true,
          learnFromUser: true,
          overridable: true
        }
      },
      {
        id: 'peak_hour_efficiency',
        name: 'Peak Hour Efficiency',
        enabled: true,
        priority: 7,
        triggers: {
          timeOfDay: { start: 17, end: 21 },
          energyPricing: 'peak'
        },
        actions: {
          maxEnergyBudget: 1.5,
          comfortPriority: 0.6,
          responsiveness: 'delayed'
        },
        automation: {
          adaptToWeather: true,
          learnFromUser: false,
          overridable: true
        }
      },
      {
        id: 'weather_adaptive',
        name: 'Weather Adaptive',
        enabled: true,
        priority: 5,
        triggers: {
          seasonalConditions: {
            minOutdoorTemp: -10,
            maxOutdoorTemp: 35
          }
        },
        actions: {
          comfortPriority: 0.7,
          responsiveness: 'immediate'
        },
        automation: {
          adaptToWeather: true,
          learnFromUser: true,
          overridable: true
        }
      }
    ];
    
    for (const rule of defaultRules) {
      this.scheduleRules.set(rule.id, rule);
    }
    
    this.logger.info('📚 [Smart Scheduler] Default rules loaded', {
      count: defaultRules.length
    });
  }
  
  /**
   * Start periodic background processes
   */
  private startPeriodicProcesses(): void {
    // Main scheduler loop
    this.schedulerInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.processScheduledEvents();
      }
    }, 60000); // Every minute
    
    // Auto-optimization
    if (this.config.autoOptimizationInterval > 0) {
      this.optimizationInterval = setInterval(async () => {
        if (this.isRunning) {
          await this.runAutoOptimization();
        }
      }, this.config.autoOptimizationInterval * 60000);
    }
    
    // Weather updates
    if (this.config.weatherUpdateInterval > 0) {
      this.weatherInterval = setInterval(async () => {
        if (this.isRunning) {
          await this.updateWeatherBasedAutomation();
        }
      }, this.config.weatherUpdateInterval * 60000);
    }
  }
  
  /**
   * Process scheduled events
   */
  private async processScheduledEvents(): Promise<void> {
    const now = new Date();
    
    // Find due schedule items
    const dueItems = this.currentSchedule.filter(item => 
      item.startTime <= now && item.endTime > now
    );
    
    for (const item of dueItems) {
      try {
        await this.executeScheduleItem(item);
      } catch (error) {
        this.logger.error('❌ [Smart Scheduler] Failed to execute schedule item', error);
      }
    }
    
    // Clean up completed events
    this.cleanupCompletedEvents();
  }
  
  /**
   * Run auto-optimization
   */
  private async runAutoOptimization(): Promise<void> {
    if (!this.optimizer) {
      return;
    }
    
    try {
      const context = await this.getCurrentContext();
      const optimization = await this.optimizer.optimizeDecision(context);
      
      // Apply optimization if it suggests a change
      if (optimization.overallScore > 0.7) {
        await this.triggerAutomation(
          'system_optimization',
          context,
          `Auto-optimization suggested ${optimization.action} (score: ${optimization.overallScore.toFixed(2)})`
        );
      }
      
    } catch (error) {
      this.logger.debug('⚠️ [Smart Scheduler] Auto-optimization failed', error);
    }
  }
  
  /**
   * Update weather-based automation
   */
  private async updateWeatherBasedAutomation(): Promise<void> {
    if (!this.analytics) {
      return;
    }
    
    try {
      // Get weather predictions
      const tempPrediction = await this.analytics.predictIndoorTemperature(1);
      
      // Check if significant weather change is predicted
      const context = await this.getCurrentContext();
      const tempChange = Math.abs(tempPrediction.predictedValue - (context.indoorTemp || 21));
      
      if (tempChange > 2 && tempPrediction.confidence > 0.6) {
        await this.triggerAutomation(
          'weather_change',
          context,
          `Significant temperature change predicted: ${tempPrediction.predictedValue.toFixed(1)}°C`
        );
      }
      
    } catch (error) {
      this.logger.debug('⚠️ [Smart Scheduler] Weather automation update failed', error);
    }
  }
  
  /**
   * Find applicable rules for a given time and context
   */
  private findApplicableRules(time: Date, context?: HVACDecisionContext): ScheduleRule[] {
    const applicable: ScheduleRule[] = [];
    
    for (const rule of this.scheduleRules.values()) {
      if (!rule.enabled) continue;
      
      if (this.ruleApplies(rule, time, context)) {
        applicable.push(rule);
      }
    }
    
    return applicable.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Check if a rule applies to given time and context
   */
  private ruleApplies(rule: ScheduleRule, time: Date, context?: HVACDecisionContext): boolean {
    const triggers = rule.triggers;
    
    // Check time of day
    if (triggers.timeOfDay) {
      const hour = time.getHours();
      const { start, end } = triggers.timeOfDay;
      
      if (start <= end) {
        if (hour < start || hour >= end) return false;
      } else {
        // Spans midnight
        if (hour < start && hour >= end) return false;
      }
    }
    
    // Check days of week
    if (triggers.daysOfWeek) {
      const dayOfWeek = time.getDay();
      if (!triggers.daysOfWeek.includes(dayOfWeek)) return false;
    }
    
    // Check seasonal conditions
    if (triggers.seasonalConditions && context) {
      const conditions = triggers.seasonalConditions;
      const outdoorTemp = context.outdoorTemp;
      
      if (outdoorTemp !== undefined) {
        if (conditions.minOutdoorTemp !== undefined && outdoorTemp < conditions.minOutdoorTemp) return false;
        if (conditions.maxOutdoorTemp !== undefined && outdoorTemp > conditions.maxOutdoorTemp) return false;
      }
    }
    
    return true;
  }
  
  /**
   * Create a schedule item for a time slot
   */
  private async createScheduleItem(
    startTime: Date,
    applicableRules: ScheduleRule[],
    weatherContext?: any,
    personalizedWeights?: any
  ): Promise<ScheduleItem> {
    
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration
    
    // Determine target temperature from rules
    let targetTemp = 22; // Default
    let priority: ScheduleItem['priority'] = 'medium';
    
    if (applicableRules.length > 0) {
      const primaryRule = applicableRules[0]; // Highest priority
      targetTemp = primaryRule.actions.targetTemperature || targetTemp;
      priority = primaryRule.priority >= 8 ? 'high' : primaryRule.priority >= 5 ? 'medium' : 'low';
    }
    
    // Adjust based on personalized learning
    if (personalizedWeights && this.learning) {
      const personalizedRecs = await this.learning.getPersonalizedRecommendations({
        currentHour: startTime.getHours(),
        systemMode: SystemMode.AUTO,
        currentMode: 'idle'
      });
      
      if (personalizedRecs.confidence > 0.5) {
        targetTemp = personalizedRecs.targetTemp;
      }
    }
    
    // Adjust based on weather predictions
    if (weatherContext && weatherContext.confidence > 0.6) {
      const predictedTemp = weatherContext.predictedIndoorTemp;
      const adjustment = (targetTemp - predictedTemp) * 0.3; // 30% compensation
      targetTemp += adjustment;
    }
    
    return {
      startTime,
      endTime,
      targetTemp: Math.round(targetTemp * 10) / 10,
      priority,
      energyBudget: 2.0 // Default energy budget
    };
  }
  
  /**
   * Execute a schedule item
   */
  private async executeScheduleItem(item: ScheduleItem): Promise<void> {
    const event: AutomationEvent = {
      id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      eventType: 'schedule_trigger',
      context: await this.getCurrentContext(),
      action: {
        type: 'temperature_change',
        details: {
          targetTemperature: item.targetTemp,
          priority: item.priority
        },
        reason: `Scheduled temperature adjustment to ${item.targetTemp}°C`
      },
      status: 'pending'
    };
    
    await this.executeAutomationEvent(event);
  }
  
  /**
   * Execute an automation event
   */
  private async executeAutomationEvent(event: AutomationEvent): Promise<void> {
    this.activeEvents.set(event.id, event);
    event.status = 'executing';
    
    const startTime = performance.now();
    
    try {
      // In a real implementation, this would call the HVAC controller
      // For now, we'll simulate the execution
      
      this.logger.info('⚡ [Smart Scheduler] Executing automation', {
        eventId: event.id,
        eventType: event.eventType,
        actionType: event.action.type,
        reason: event.action.reason
      });
      
      // Simulate execution delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mark as completed
      event.status = 'completed';
      event.result = {
        success: true,
        executionTime: performance.now() - startTime
      };
      
      this.logger.info('✅ [Smart Scheduler] Automation completed', {
        eventId: event.id,
        executionTime: event.result.executionTime
      });
      
    } catch (error) {
      event.status = 'failed';
      event.result = {
        success: false,
        executionTime: performance.now() - startTime
      };
      
      this.logger.error('❌ [Smart Scheduler] Automation failed', error, {
        eventId: event.id
      });
    } finally {
      // Move to history
      this.eventHistory.push(event);
      this.activeEvents.delete(event.id);
      
      // Limit history size
      if (this.eventHistory.length > 1000) {
        this.eventHistory = this.eventHistory.slice(-500);
      }
    }
  }
  
  /**
   * Helper methods
   */
  
  private async getCurrentContext(): Promise<HVACDecisionContext> {
    const now = new Date();
    
    return {
      currentHour: now.getHours(),
      isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle',
      indoorTemp: 21, // Would come from sensors
      outdoorTemp: 15  // Would come from weather service
    };
  }
  
  private async createOptimizationContext(
    item: ScheduleItem,
    previousItem?: ScheduleItem
  ): Promise<HVACDecisionContext> {
    
    return {
      targetTemp: item.targetTemp,
      currentHour: item.startTime.getHours(),
      isWeekday: item.startTime.getDay() >= 1 && item.startTime.getDay() <= 5,
      systemMode: SystemMode.AUTO,
      currentMode: 'idle'
    };
  }
  
  private determineActionType(rule: ScheduleRule): AutomationEvent['action']['type'] {
    if (rule.actions.targetTemperature !== undefined) {
      return 'temperature_change';
    }
    if (rule.actions.systemMode !== undefined) {
      return 'mode_change';
    }
    return 'system_optimization';
  }
  
  private calculateAverageTargetTemp(schedule: ScheduleItem[]): number {
    if (schedule.length === 0) return 22;
    
    return schedule.reduce((sum, item) => sum + item.targetTemp, 0) / schedule.length;
  }
  
  private calculateTotalEnergyBudget(schedule: ScheduleItem[]): number {
    return schedule.reduce((sum, item) => sum + (item.energyBudget || 0), 0);
  }
  
  private cleanupCompletedEvents(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const [id, event] of this.activeEvents.entries()) {
      if (event.timestamp < cutoff && ['completed', 'failed', 'cancelled'].includes(event.status)) {
        this.activeEvents.delete(id);
      }
    }
  }
  
  /**
   * Get all schedule rules
   */
  getScheduleRules(): ScheduleRule[] {
    return Array.from(this.scheduleRules.values());
  }
  
  /**
   * Get current schedule
   */
  getCurrentSchedule(): ScheduleItem[] {
    return [...this.currentSchedule];
  }
  
  /**
   * Get automation event history
   */
  getEventHistory(limit: number = 50): AutomationEvent[] {
    return this.eventHistory.slice(-limit);
  }
}