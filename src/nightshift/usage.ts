import type Database from "better-sqlite3";
import type { UsageSnapshot } from "./types.js";
import type { UsageClient } from "../usage/index.js";

export class WeeklyUsageTracker {
  private db: Database.Database;
  private weeklyLimit: number;
  private usageClient?: UsageClient;

  constructor(
    db: Database.Database,
    weeklySessionMinutesLimit: number,
    usageClient?: UsageClient
  ) {
    this.db = db;
    this.weeklyLimit = weeklySessionMinutesLimit;
    this.usageClient = usageClient;
  }

  async getSnapshot(): Promise<UsageSnapshot> {
    // Try real API data first
    if (this.usageClient) {
      const apiData = await this.usageClient.fetchUsage();
      if (apiData) {
        return {
          totalSessionMinutes: this.getTotalSessionMinutes(),
          weeklyLimit: this.weeklyLimit,
          usagePercent: apiData.sevenDayOpus.utilization,
          source: "api",
          fiveHourUtilization: apiData.fiveHour.utilization,
        };
      }
    }

    // Fall back to session-minutes estimation
    const totalMinutes = this.getTotalSessionMinutes();
    return {
      totalSessionMinutes: totalMinutes,
      weeklyLimit: this.weeklyLimit,
      usagePercent: this.weeklyLimit > 0 ? (totalMinutes / this.weeklyLimit) * 100 : 0,
      source: "estimated",
    };
  }

  async getRealUsagePercent(): Promise<number | null> {
    if (!this.usageClient) return null;
    const data = await this.usageClient.fetchUsage();
    return data?.sevenDayOpus.utilization ?? null;
  }

  private getTotalSessionMinutes(): number {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Completed sessions in last 7 days
    const completed = this.db.prepare(
      `SELECT COALESCE(SUM(
        (julianday(ended_at) - julianday(started_at)) * 24 * 60
      ), 0) as total
       FROM sessions
       WHERE ended_at IS NOT NULL AND started_at >= ?`
    ).get(sevenDaysAgo) as { total: number };

    // Active sessions (still running) started in last 7 days
    const now = new Date().toISOString();
    const active = this.db.prepare(
      `SELECT COALESCE(SUM(
        (julianday(?) - julianday(started_at)) * 24 * 60
      ), 0) as total
       FROM sessions
       WHERE ended_at IS NULL AND started_at >= ?`
    ).get(now, sevenDaysAgo) as { total: number };

    return completed.total + active.total;
  }
}
