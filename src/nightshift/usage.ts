import type Database from "better-sqlite3";
import type { UsageSnapshot } from "./types.js";

export class WeeklyUsageTracker {
  private db: Database.Database;
  private weeklyLimit: number;

  constructor(db: Database.Database, weeklySessionMinutesLimit: number) {
    this.db = db;
    this.weeklyLimit = weeklySessionMinutesLimit;
  }

  getSnapshot(): UsageSnapshot {
    const totalMinutes = this.getTotalSessionMinutes();
    return {
      totalSessionMinutes: totalMinutes,
      weeklyLimit: this.weeklyLimit,
      usagePercent: this.weeklyLimit > 0 ? (totalMinutes / this.weeklyLimit) * 100 : 0,
    };
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
