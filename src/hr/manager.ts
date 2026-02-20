import type { Database } from "bun:sqlite";
import type { SessionRecord, CapacityCheck, BudgetSnapshot, UsageSnapshotRecord } from "./types.js";

export interface HRManagerOptions {
  project: string;
  maxProjectSessions: number;
  maxTotalSessions: number;
  maxDailyCostUsd: number;
  estimatedCostPerMinute: number;
  planPriceUsd: number;
}

export class HRManager {
  private db: Database;
  private options: HRManagerOptions;

  constructor(db: Database, options: HRManagerOptions) {
    this.db = db;
    this.options = options;
  }

  canSpawn(overrides?: { maxProjectSessions?: number }): CapacityCheck {
    const projectSessions = this.getActiveSessionCount(this.options.project);
    const totalSessions = this.getActiveSessionCount();
    const dailyCost = this.getEstimatedDailyCost();

    const maxProject = overrides?.maxProjectSessions ?? this.options.maxProjectSessions;

    if (projectSessions >= maxProject) {
      return {
        canSpawn: false,
        reason: `Project session limit reached (${projectSessions}/${maxProject})`,
        activeProjectSessions: projectSessions,
        activeTotalSessions: totalSessions,
        estimatedDailyCostUsd: dailyCost,
      };
    }

    if (totalSessions >= this.options.maxTotalSessions) {
      return {
        canSpawn: false,
        reason: `Global session limit reached (${totalSessions}/${this.options.maxTotalSessions})`,
        activeProjectSessions: projectSessions,
        activeTotalSessions: totalSessions,
        estimatedDailyCostUsd: dailyCost,
      };
    }

    if (dailyCost >= this.options.maxDailyCostUsd) {
      return {
        canSpawn: false,
        reason: `Daily cost limit reached ($${dailyCost.toFixed(2)}/$${this.options.maxDailyCostUsd.toFixed(2)})`,
        activeProjectSessions: projectSessions,
        activeTotalSessions: totalSessions,
        estimatedDailyCostUsd: dailyCost,
      };
    }

    return {
      canSpawn: true,
      activeProjectSessions: projectSessions,
      activeTotalSessions: totalSessions,
      estimatedDailyCostUsd: dailyCost,
    };
  }

  recordSessionStart(session: Omit<SessionRecord, "id" | "ended_at" | "estimated_cost_usd">): number {
    const stmt = this.db.prepare(
      `INSERT INTO sessions (project, role, issue_number, tmux_session, worktree_path, worktree_branch, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      session.project,
      session.role,
      session.issue_number ?? null,
      session.tmux_session,
      session.worktree_path ?? null,
      session.worktree_branch ?? null,
      session.started_at
    );
    return Number(result.lastInsertRowid);
  }

  updateSessionBranch(sessionId: number, branch: string): void {
    this.db.prepare(
      "UPDATE sessions SET worktree_branch = ? WHERE id = ?"
    ).run(branch, sessionId);
  }

  recordSessionEnd(sessionId: number): void {
    const endedAt = new Date().toISOString();
    const session = this.db.prepare("SELECT started_at FROM sessions WHERE id = ?").get(sessionId) as
      | { started_at: string }
      | undefined;

    if (!session) return;

    const durationMinutes =
      (new Date(endedAt).getTime() - new Date(session.started_at).getTime()) / 60000;
    const estimatedCost = durationMinutes * this.options.estimatedCostPerMinute;

    this.db.prepare(
      "UPDATE sessions SET ended_at = ?, estimated_cost_usd = ? WHERE id = ?"
    ).run(endedAt, estimatedCost, sessionId);
  }

  getActiveSessions(project?: string): SessionRecord[] {
    if (project) {
      return this.db
        .prepare("SELECT * FROM sessions WHERE ended_at IS NULL AND project = ?")
        .all(project) as SessionRecord[];
    }
    return this.db
      .prepare("SELECT * FROM sessions WHERE ended_at IS NULL")
      .all() as SessionRecord[];
  }

  recordUsageSnapshot(snapshot: Omit<UsageSnapshotRecord, "id">): void {
    this.db.prepare(
      `INSERT INTO usage_snapshots (timestamp, five_hour_utilization, seven_day_utilization, source)
       VALUES (?, ?, ?, ?)`
    ).run(
      snapshot.timestamp,
      snapshot.five_hour_utilization,
      snapshot.seven_day_utilization,
      snapshot.source
    );
  }

  pruneOldSnapshots(): void {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM usage_snapshots WHERE timestamp < ?").run(sevenDaysAgo);
  }

  getRecentSnapshots(count: number): UsageSnapshotRecord[] {
    return this.db.prepare(
      "SELECT * FROM usage_snapshots ORDER BY timestamp DESC LIMIT ?"
    ).all(count) as UsageSnapshotRecord[];
  }

  getBudgetSnapshot(): BudgetSnapshot {
    const projectSessions = this.getActiveSessionCount(this.options.project);
    const totalSessions = this.getActiveSessionCount();
    const sessionBasedDailyCost = this.getEstimatedDailyCost();

    const latestSnapshot = this.getRecentSnapshots(1)[0];
    const hasApiData = latestSnapshot?.source === "api";

    // Burn rate from utilization level: 5-hour utilization is more responsive
    // to current activity than 7-day. At U% utilization sustained over a month,
    // cost = (U / 100) * planPriceUsd. Per-minute = that / (30 * 24 * 60).
    const burnRatePerMinute = hasApiData
      ? this.computeBurnRate(latestSnapshot.five_hour_utilization)
      : totalSessions * this.options.estimatedCostPerMinute;

    // Monthly projection from 7-day utilization: planPriceUsd is already monthly,
    // so U% of 7-day window ≈ U% of monthly cost.
    const estimatedMonthlyCostUsd = hasApiData
      ? (latestSnapshot.seven_day_utilization / 100) * this.options.planPriceUsd
      : undefined;

    // Daily cost: use utilization-derived value when available
    const estimatedDailyCostUsd = estimatedMonthlyCostUsd != null
      ? estimatedMonthlyCostUsd / 30
      : sessionBasedDailyCost;

    return {
      activeProjectSessions: projectSessions,
      activeTotalSessions: totalSessions,
      maxProjectSessions: this.options.maxProjectSessions,
      maxTotalSessions: this.options.maxTotalSessions,
      estimatedDailyCostUsd,
      maxDailyCostUsd: this.options.maxDailyCostUsd,
      burnRatePerMinute,
      estimatedMonthlyCostUsd,
      burnRateSource: hasApiData ? "api" : "estimated",
      planPriceUsd: this.options.planPriceUsd,
    };
  }

  computeBurnRate(utilizationPercent: number): number {
    const minutesPerMonth = 30 * 24 * 60;
    return (utilizationPercent / 100) * this.options.planPriceUsd / minutesPerMonth;
  }

  private getActiveSessionCount(project?: string): number {
    if (project) {
      const row = this.db
        .prepare("SELECT COUNT(*) as count FROM sessions WHERE ended_at IS NULL AND project = ?")
        .get(project) as { count: number };
      return row.count;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE ended_at IS NULL")
      .get() as { count: number };
    return row.count;
  }

  private getEstimatedDailyCost(): number {
    const today = new Date().toISOString().split("T")[0];
    // Cost from completed sessions today
    const completed = this.db.prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM sessions WHERE ended_at IS NOT NULL AND started_at >= ?`
    ).get(today + "T00:00:00.000Z") as { total: number };

    // Estimated cost from active sessions (based on duration so far)
    const active = this.getActiveSessions();
    const now = Date.now();
    let activeCost = 0;
    for (const session of active) {
      const startTime = new Date(session.started_at).getTime();
      if (startTime >= new Date(today + "T00:00:00.000Z").getTime()) {
        const minutes = (now - startTime) / 60000;
        activeCost += minutes * this.options.estimatedCostPerMinute;
      }
    }

    return completed.total + activeCost;
  }
}
