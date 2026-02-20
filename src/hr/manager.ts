import type Database from "better-sqlite3";
import type { SessionRecord, CapacityCheck, BudgetSnapshot } from "./types.js";

export interface HRManagerOptions {
  project: string;
  maxProjectSessions: number;
  maxTotalSessions: number;
  maxDailyCostUsd: number;
  estimatedCostPerMinute: number;
}

export class HRManager {
  private db: Database.Database;
  private options: HRManagerOptions;

  constructor(db: Database.Database, options: HRManagerOptions) {
    this.db = db;
    this.options = options;
  }

  canSpawn(): CapacityCheck {
    const projectSessions = this.getActiveSessionCount(this.options.project);
    const totalSessions = this.getActiveSessionCount();
    const dailyCost = this.getEstimatedDailyCost();

    if (projectSessions >= this.options.maxProjectSessions) {
      return {
        canSpawn: false,
        reason: `Project session limit reached (${projectSessions}/${this.options.maxProjectSessions})`,
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

  getBudgetSnapshot(): BudgetSnapshot {
    const projectSessions = this.getActiveSessionCount(this.options.project);
    const totalSessions = this.getActiveSessionCount();
    const dailyCost = this.getEstimatedDailyCost();

    return {
      activeProjectSessions: projectSessions,
      activeTotalSessions: totalSessions,
      maxProjectSessions: this.options.maxProjectSessions,
      maxTotalSessions: this.options.maxTotalSessions,
      estimatedDailyCostUsd: dailyCost,
      maxDailyCostUsd: this.options.maxDailyCostUsd,
      burnRatePerMinute: totalSessions * this.options.estimatedCostPerMinute,
    };
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
