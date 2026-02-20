import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { WeeklyUsageTracker } from "./usage.js";
import type { UsageClient, ClaudeUsageData } from "../usage/index.js";

function createTestDb(): Database.Database {
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
  `);
  return db;
}

function createMockUsageClient(data: ClaudeUsageData | null): UsageClient {
  return {
    fetchUsage: vi.fn().mockResolvedValue(data),
  } as any;
}

describe("WeeklyUsageTracker", () => {
  it("returns zero usage for empty database", async () => {
    const db = createTestDb();
    const tracker = new WeeklyUsageTracker(db, 600);
    const snapshot = await tracker.getSnapshot();
    expect(snapshot.totalSessionMinutes).toBe(0);
    expect(snapshot.usagePercent).toBe(0);
    expect(snapshot.weeklyLimit).toBe(600);
    expect(snapshot.source).toBe("estimated");
  });

  it("counts completed sessions in last 7 days", async () => {
    const db = createTestDb();
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    db.prepare(
      "INSERT INTO sessions (project, role, tmux_session, started_at, ended_at) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "developer", "session1", twoHoursAgo.toISOString(), oneHourAgo.toISOString());

    const tracker = new WeeklyUsageTracker(db, 600);
    const snapshot = await tracker.getSnapshot();
    // Should be approximately 60 minutes
    expect(snapshot.totalSessionMinutes).toBeGreaterThan(55);
    expect(snapshot.totalSessionMinutes).toBeLessThan(65);
    expect(snapshot.source).toBe("estimated");
  });

  it("counts active sessions", async () => {
    const db = createTestDb();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    db.prepare(
      "INSERT INTO sessions (project, role, tmux_session, started_at) VALUES (?, ?, ?, ?)"
    ).run("test", "developer", "session1", thirtyMinutesAgo.toISOString());

    const tracker = new WeeklyUsageTracker(db, 600);
    const snapshot = await tracker.getSnapshot();
    // Should be approximately 30 minutes
    expect(snapshot.totalSessionMinutes).toBeGreaterThan(25);
    expect(snapshot.totalSessionMinutes).toBeLessThan(35);
  });

  it("calculates usage percentage correctly", async () => {
    const db = createTestDb();
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    // 3-hour session = 180 minutes out of 600 limit = 30%
    db.prepare(
      "INSERT INTO sessions (project, role, tmux_session, started_at, ended_at) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "developer", "session1", sixHoursAgo.toISOString(), threeHoursAgo.toISOString());

    const tracker = new WeeklyUsageTracker(db, 600);
    const snapshot = await tracker.getSnapshot();
    expect(snapshot.usagePercent).toBeGreaterThan(28);
    expect(snapshot.usagePercent).toBeLessThan(32);
  });

  it("ignores sessions older than 7 days", async () => {
    const db = createTestDb();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);

    db.prepare(
      "INSERT INTO sessions (project, role, tmux_session, started_at, ended_at) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "developer", "session1", tenDaysAgo.toISOString(), nineDaysAgo.toISOString());

    const tracker = new WeeklyUsageTracker(db, 600);
    const snapshot = await tracker.getSnapshot();
    expect(snapshot.totalSessionMinutes).toBe(0);
  });

  describe("with UsageClient", () => {
    it("uses API data when available", async () => {
      const db = createTestDb();
      const client = createMockUsageClient({
        fiveHour: { utilization: 15.0, resetsAt: null },
        sevenDayOpus: { utilization: 42.0, resetsAt: null },
        sevenDaySonnet: { utilization: 0, resetsAt: null },
      });

      const tracker = new WeeklyUsageTracker(db, 600, client);
      const snapshot = await tracker.getSnapshot();

      expect(snapshot.usagePercent).toBe(42.0);
      expect(snapshot.source).toBe("api");
      expect(snapshot.fiveHourUtilization).toBe(15.0);
    });

    it("falls back to estimated when API returns null", async () => {
      const db = createTestDb();
      const client = createMockUsageClient(null);

      const tracker = new WeeklyUsageTracker(db, 600, client);
      const snapshot = await tracker.getSnapshot();

      expect(snapshot.source).toBe("estimated");
      expect(snapshot.fiveHourUtilization).toBeUndefined();
    });

    it("getRealUsagePercent returns sevenDayOpus utilization", async () => {
      const db = createTestDb();
      const client = createMockUsageClient({
        fiveHour: { utilization: 10.0, resetsAt: null },
        sevenDayOpus: { utilization: 55.0, resetsAt: null },
        sevenDaySonnet: { utilization: 0, resetsAt: null },
      });

      const tracker = new WeeklyUsageTracker(db, 600, client);
      const percent = await tracker.getRealUsagePercent();
      expect(percent).toBe(55.0);
    });

    it("getRealUsagePercent returns null without client", async () => {
      const db = createTestDb();
      const tracker = new WeeklyUsageTracker(db, 600);
      const percent = await tracker.getRealUsagePercent();
      expect(percent).toBeNull();
    });
  });
});
