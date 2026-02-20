import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { HRManager } from "./manager.js";

// Use in-memory SQLite for tests
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      role TEXT NOT NULL,
      issue_number INTEGER,
      tmux_session TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      estimated_cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
  `);
  return db;
}

describe("HRManager", () => {
  let db: Database.Database;
  let hr: HRManager;

  beforeEach(() => {
    db = createTestDb();
    hr = new HRManager(db, {
      project: "test-project",
      maxProjectSessions: 3,
      maxTotalSessions: 5,
      maxDailyCostUsd: 50,
      estimatedCostPerMinute: 0.15,
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
    it("returns correct snapshot", () => {
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
    });
  });
});
