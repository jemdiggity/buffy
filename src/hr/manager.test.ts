import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { HRManager } from "./manager.js";

// Use in-memory SQLite for tests
function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      role TEXT NOT NULL,
      issue_number INTEGER,
      tmux_session TEXT NOT NULL,
      worktree_path TEXT,
      worktree_branch TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      estimated_cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      five_hour_utilization REAL NOT NULL,
      seven_day_utilization REAL NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_snapshots_ts ON usage_snapshots(timestamp);
  `);
  return db;
}

describe("HRManager", () => {
  let db: Database;
  let hr: HRManager;

  beforeEach(() => {
    db = createTestDb();
    hr = new HRManager(db, {
      project: "test-project",
      maxProjectSessions: 3,
      maxTotalSessions: 5,
      maxDailyCostUsd: 50,
      estimatedCostPerMinute: 0.15,
      planPriceUsd: 200,
    });
  });

  afterEach(() => {
    db.close();
  });

  describe("canSpawn", () => {
    it("returns true when under all limits", () => {
      const check = hr.canSpawn();
      expect(check.canSpawn).toBe(true);
      expect(check.activeProjectSessions).toBe(0);
      expect(check.activeTotalSessions).toBe(0);
    });

    it("returns false when project session limit reached", () => {
      for (let i = 0; i < 3; i++) {
        hr.recordSessionStart({
          project: "test-project",
          role: "developer",
          issue_number: i + 1,
          tmux_session: `buffy-test-dev-${i + 1}`,
          started_at: new Date().toISOString(),
        });
      }
      const check = hr.canSpawn();
      expect(check.canSpawn).toBe(false);
      expect(check.reason).toContain("Project session limit");
    });

    it("returns false when global session limit reached", () => {
      // Fill up with sessions from different projects
      for (let i = 0; i < 5; i++) {
        hr.recordSessionStart({
          project: `project-${i}`,
          role: "developer",
          tmux_session: `buffy-p${i}-dev-1`,
          started_at: new Date().toISOString(),
        });
      }
      const check = hr.canSpawn();
      expect(check.canSpawn).toBe(false);
      expect(check.reason).toContain("Global session limit");
    });
  });

  describe("session lifecycle", () => {
    it("records session start and end", () => {
      const id = hr.recordSessionStart({
        project: "test-project",
        role: "developer",
        issue_number: 42,
        tmux_session: "buffy-test-dev-42",
        started_at: new Date().toISOString(),
      });
      expect(id).toBeGreaterThan(0);

      const active = hr.getActiveSessions("test-project");
      expect(active).toHaveLength(1);
      expect(active[0]!.issue_number).toBe(42);

      hr.recordSessionEnd(id);
      const afterEnd = hr.getActiveSessions("test-project");
      expect(afterEnd).toHaveLength(0);
    });
  });

  describe("getBudgetSnapshot", () => {
    it("returns correct snapshot with estimated fallback when no API data", () => {
      hr.recordSessionStart({
        project: "test-project",
        role: "developer",
        tmux_session: "buffy-test-dev-1",
        started_at: new Date().toISOString(),
      });
      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.activeProjectSessions).toBe(1);
      expect(snapshot.activeTotalSessions).toBe(1);
      expect(snapshot.maxProjectSessions).toBe(3);
      expect(snapshot.maxTotalSessions).toBe(5);
      expect(snapshot.burnRatePerMinute).toBe(0.15);
      expect(snapshot.burnRateSource).toBe("estimated");
      expect(snapshot.planPriceUsd).toBe(200);
      expect(snapshot.estimatedMonthlyCostUsd).toBeUndefined();
    });

    it("uses API-derived burn rate when snapshots exist", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 50,
        seven_day_utilization: 30,
        source: "api",
      });

      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.burnRateSource).toBe("api");
      // 5-hour util of 50% → (50/100) * 200 / (30*24*60) = 100 / 43200 ≈ 0.002315
      expect(snapshot.burnRatePerMinute).toBeCloseTo(100 / 43200, 5);
      // 7-day util of 30% → (30/100) * 200 = 60
      expect(snapshot.estimatedMonthlyCostUsd).toBe(60);
      // Daily cost from monthly: 60 / 30 = 2
      expect(snapshot.estimatedDailyCostUsd).toBe(2);
    });

    it("falls back to estimated when latest snapshot is not from API", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 50,
        seven_day_utilization: 30,
        source: "estimated",
      });

      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.burnRateSource).toBe("estimated");
      expect(snapshot.estimatedMonthlyCostUsd).toBeUndefined();
    });
  });

  describe("computeBurnRate", () => {
    it("returns correct $/min for 100% utilization", () => {
      // 100% utilization on $200 plan = $200/month = $200 / 43200 min
      const rate = hr.computeBurnRate(100);
      expect(rate).toBeCloseTo(200 / 43200, 5);
    });

    it("returns correct $/min for 50% utilization", () => {
      const rate = hr.computeBurnRate(50);
      expect(rate).toBeCloseTo(100 / 43200, 5);
    });

    it("returns 0 for 0% utilization", () => {
      expect(hr.computeBurnRate(0)).toBe(0);
    });

    it("scales linearly with plan price", () => {
      const hrExpensive = new HRManager(db, {
        project: "test",
        maxProjectSessions: 5,
        maxTotalSessions: 10,
        maxDailyCostUsd: 100,
        estimatedCostPerMinute: 0.15,
        planPriceUsd: 100, // Max 5x plan
      });
      // 100% on $100 plan = $100/month
      const rate = hrExpensive.computeBurnRate(100);
      expect(rate).toBeCloseTo(100 / 43200, 5);
    });

    it("burn rate at steady state matches monthly estimate", () => {
      // At 40% utilization:
      // Monthly estimate: (40/100) * 200 = $80
      // Burn rate: (40/100) * 200 / 43200 ≈ $0.001852/min
      // Over a month: 0.001852 * 43200 = $80 ✓
      const rate = hr.computeBurnRate(40);
      const monthlyFromBurnRate = rate * 30 * 24 * 60;
      const monthlyFromEstimate = (40 / 100) * 200;
      expect(monthlyFromBurnRate).toBeCloseTo(monthlyFromEstimate, 2);
    });
  });

  describe("usage snapshots", () => {
    it("records and retrieves snapshots", () => {
      hr.recordUsageSnapshot({
        timestamp: "2024-01-15T10:00:00.000Z",
        five_hour_utilization: 25.5,
        seven_day_utilization: 42.0,
        source: "api",
      });

      const snapshots = hr.getRecentSnapshots(1);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.five_hour_utilization).toBe(25.5);
      expect(snapshots[0]!.seven_day_utilization).toBe(42.0);
      expect(snapshots[0]!.source).toBe("api");
    });

    it("retrieves snapshots in descending timestamp order", () => {
      hr.recordUsageSnapshot({
        timestamp: "2024-01-15T10:00:00.000Z",
        five_hour_utilization: 20,
        seven_day_utilization: 30,
        source: "api",
      });
      hr.recordUsageSnapshot({
        timestamp: "2024-01-15T11:00:00.000Z",
        five_hour_utilization: 25,
        seven_day_utilization: 35,
        source: "api",
      });

      const snapshots = hr.getRecentSnapshots(2);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]!.five_hour_utilization).toBe(25);
      expect(snapshots[1]!.five_hour_utilization).toBe(20);
    });

    it("limits returned snapshots to requested count", () => {
      for (let i = 0; i < 5; i++) {
        hr.recordUsageSnapshot({
          timestamp: new Date(Date.now() - i * 60000).toISOString(),
          five_hour_utilization: i * 10,
          seven_day_utilization: i * 5,
          source: "api",
        });
      }

      expect(hr.getRecentSnapshots(2)).toHaveLength(2);
      expect(hr.getRecentSnapshots(10)).toHaveLength(5);
    });

    it("prunes snapshots older than 7 days", () => {
      // Insert an old snapshot (8 days ago)
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      hr.recordUsageSnapshot({
        timestamp: eightDaysAgo,
        five_hour_utilization: 10,
        seven_day_utilization: 20,
        source: "api",
      });

      // Insert a recent snapshot
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 30,
        seven_day_utilization: 40,
        source: "api",
      });

      expect(hr.getRecentSnapshots(10)).toHaveLength(2);

      hr.pruneOldSnapshots();

      const remaining = hr.getRecentSnapshots(10);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.five_hour_utilization).toBe(30);
    });

    it("keeps snapshots within the 7-day window", () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      hr.recordUsageSnapshot({
        timestamp: sixDaysAgo,
        five_hour_utilization: 10,
        seven_day_utilization: 20,
        source: "api",
      });

      hr.pruneOldSnapshots();
      expect(hr.getRecentSnapshots(10)).toHaveLength(1);
    });
  });

  describe("monthly estimate", () => {
    it("returns plan price at 100% utilization", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 100,
        seven_day_utilization: 100,
        source: "api",
      });
      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.estimatedMonthlyCostUsd).toBe(200);
    });

    it("returns 0 at 0% utilization", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 0,
        seven_day_utilization: 0,
        source: "api",
      });
      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.estimatedMonthlyCostUsd).toBe(0);
    });

    it("returns correct value at 25% utilization", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 25,
        seven_day_utilization: 25,
        source: "api",
      });
      const snapshot = hr.getBudgetSnapshot();
      // 25% of $200 = $50
      expect(snapshot.estimatedMonthlyCostUsd).toBe(50);
    });

    it("never exceeds plan price at 100% utilization", () => {
      hr.recordUsageSnapshot({
        timestamp: new Date().toISOString(),
        five_hour_utilization: 100,
        seven_day_utilization: 100,
        source: "api",
      });
      const snapshot = hr.getBudgetSnapshot();
      expect(snapshot.estimatedMonthlyCostUsd).toBeLessThanOrEqual(200);
    });
  });
});
