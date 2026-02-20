import type { NightShiftSection } from "../config/index.js";
import type { WeeklyUsageTracker } from "./usage.js";
import type { NightShiftState, NightShiftSpawnDecision } from "./types.js";

const FIVE_HOUR_BACKPRESSURE_THRESHOLD = 80;

export class NightShiftScheduler {
  private config: NightShiftSection;
  private usage: WeeklyUsageTracker;
  private clock: () => Date;

  constructor(
    config: NightShiftSection,
    usage: WeeklyUsageTracker,
    clock?: () => Date
  ) {
    this.config = config;
    this.usage = usage;
    this.clock = clock ?? (() => new Date());
  }

  isInWindow(now?: Date): boolean {
    if (!this.config.enabled) return false;

    const current = now ?? this.clock();
    const hour = current.getHours();
    const { start_hour, end_hour } = this.config;

    // Handle midnight crossing (e.g., start_hour: 22, end_hour: 6)
    if (start_hour <= end_hour) {
      return hour >= start_hour && hour < end_hour;
    } else {
      return hour >= start_hour || hour < end_hour;
    }
  }

  async shouldSpawn(): Promise<NightShiftSpawnDecision> {
    if (!this.config.enabled) {
      return { allowed: false, maxConcurrent: 0, reason: "Night shift disabled" };
    }

    if (!this.isInWindow()) {
      return { allowed: false, maxConcurrent: 0, reason: "Outside night shift window" };
    }

    const snapshot = await this.usage.getSnapshot();
    const weekElapsedPercent = this.getWeekElapsedPercent();

    // 5-hour backpressure: block if short-term usage is too high
    if (snapshot.fiveHourUtilization != null && snapshot.fiveHourUtilization > FIVE_HOUR_BACKPRESSURE_THRESHOLD) {
      return {
        allowed: false,
        maxConcurrent: 0,
        reason: `5-hour utilization (${snapshot.fiveHourUtilization.toFixed(1)}%) > ${FIVE_HOUR_BACKPRESSURE_THRESHOLD}%`,
      };
    }

    // If usage is ahead of time, no headroom
    if (snapshot.usagePercent >= weekElapsedPercent) {
      return {
        allowed: false,
        maxConcurrent: 0,
        reason: `Usage (${snapshot.usagePercent.toFixed(1)}%) >= week elapsed (${weekElapsedPercent.toFixed(1)}%)`,
      };
    }

    // Check safety margin
    const safetyThreshold = 100 - this.config.safety_margin_percent;
    if (snapshot.usagePercent >= safetyThreshold) {
      return {
        allowed: false,
        maxConcurrent: 0,
        reason: `Usage (${snapshot.usagePercent.toFixed(1)}%) >= safety threshold (${safetyThreshold}%)`,
      };
    }

    return {
      allowed: true,
      maxConcurrent: this.config.max_concurrent_developers ?? 5,
      reason: `Night shift active — headroom: ${(weekElapsedPercent - snapshot.usagePercent).toFixed(1)}%`,
    };
  }

  async getState(): Promise<NightShiftState> {
    const now = this.clock();
    const windowOpen = this.isInWindow(now);
    const snapshot = await this.usage.getSnapshot();
    const weekElapsedPercent = this.getWeekElapsedPercent();
    const headroomPercent = Math.max(0, weekElapsedPercent - snapshot.usagePercent);
    const safetyThreshold = 100 - this.config.safety_margin_percent;
    const throttled = snapshot.usagePercent >= safetyThreshold;

    const decision = await this.shouldSpawn();

    return {
      active: decision.allowed,
      windowOpen,
      weeklyUsagePercent: snapshot.usagePercent,
      weekElapsedPercent,
      headroomPercent,
      throttled,
      reason: decision.reason,
      nextWindowStart: this.formatNextWindow(now, this.config.start_hour),
      nextWindowEnd: this.formatNextWindow(now, this.config.end_hour),
      usageSource: snapshot.source,
      fiveHourUtilization: snapshot.fiveHourUtilization,
    };
  }

  private getWeekElapsedPercent(): number {
    const now = this.clock();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const hourOfDay = now.getHours() + now.getMinutes() / 60;
    const hoursElapsed = dayOfWeek * 24 + hourOfDay;
    return (hoursElapsed / 168) * 100; // 168 = 7 * 24
  }

  private formatNextWindow(now: Date, targetHour: number): string {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(targetHour);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return `${next.getHours()}:00`;
  }
}
