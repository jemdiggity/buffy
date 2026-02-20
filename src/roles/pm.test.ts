import { describe, it, expect, vi, beforeEach } from "vitest";
import { Database } from "bun:sqlite";
import { PMRole } from "./pm.js";
import type { PMDependencies } from "./pm.js";
import { HRManager } from "../hr/manager.js";
import { CommsBus } from "../comms/bus.js";
import { DEFAULT_PROJECT_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../config/defaults.js";

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
  `);
  return db;
}

function createMockDeps(overrides?: Partial<PMDependencies>): PMDependencies {
  const db = createTestDb();
  const hr = new HRManager(db, {
    project: "test-project",
    maxProjectSessions: 3,
    maxTotalSessions: 5,
    maxDailyCostUsd: 50,
    estimatedCostPerMinute: 0.15,
  });
  const bus = new CommsBus(db);

  return {
    config: {
      project: {
        ...DEFAULT_PROJECT_CONFIG,
        project: { ...DEFAULT_PROJECT_CONFIG.project, repo: "owner/test-project" },
      },
      global: DEFAULT_GLOBAL_CONFIG,
    },
    hr,
    bus,
    tmux: {
      createSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
      listBuffySessions: vi.fn().mockResolvedValue([]),
      sessionExists: vi.fn().mockResolvedValue(false),
      killSession: vi.fn().mockResolvedValue(undefined),
      killAllBuffySessions: vi.fn().mockResolvedValue(0),
      sendKeys: vi.fn().mockResolvedValue(undefined),
      capturePane: vi.fn().mockResolvedValue(""),
      isSessionAlive: vi.fn().mockResolvedValue(false),
    } as any,
    worktrees: {
      claudeWorktreePath: vi.fn((n: number) => `/tmp/repo/.claude/worktrees/issue-${n}`),
      discoverBranch: vi.fn().mockResolvedValue(null),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      listWorktrees: vi.fn().mockResolvedValue([]),
      worktreeExists: vi.fn().mockResolvedValue(false),
      removeAll: vi.fn().mockResolvedValue(0),
    } as any,
    prs: {
      listByLabel: vi.fn().mockResolvedValue([]),
      getPR: vi.fn().mockResolvedValue({}),
      getDiff: vi.fn().mockResolvedValue(""),
      findByBranch: vi.fn().mockResolvedValue(null),
      addLabel: vi.fn().mockResolvedValue(undefined),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      isMerged: vi.fn().mockResolvedValue(false),
      isClosed: vi.fn().mockResolvedValue(false),
      getReviewDecision: vi.fn().mockResolvedValue(null),
      getReviews: vi.fn().mockResolvedValue([]),
      mergePR: vi.fn().mockResolvedValue(undefined),
    } as any,
    issues: {
      fetchReadyIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue({}),
      addLabel: vi.fn().mockResolvedValue(undefined),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      markInProgress: vi.fn().mockResolvedValue(undefined),
      clearInProgress: vi.fn().mockResolvedValue(undefined),
      prioritize: vi.fn((issues: any[]) => issues),
    } as any,
    developer: {
      spawn: vi.fn().mockResolvedValue("buffy-test-project-dev-1"),
      isRunning: vi.fn().mockResolvedValue(false),
      buildPrompt: vi.fn().mockReturnValue("test prompt"),
      sessionName: vi.fn((p: string, n: number) => `buffy-${p}-dev-${n}`),
    } as any,
    cto: {
      spawn: vi.fn().mockResolvedValue("buffy-test-project-cto"),
      isRunning: vi.fn().mockResolvedValue(false),
      buildPrompt: vi.fn().mockReturnValue("cto prompt"),
      sessionName: vi.fn((p: string) => `buffy-${p}-cto`),
    } as any,
    projectRoot: "/tmp/test-project",
    dryRun: false,
    log: vi.fn(),
    ...overrides,
  };
}

describe("PMRole", () => {
  it("can be instantiated", () => {
    const deps = createMockDeps();
    const pm = new PMRole(deps);
    expect(pm.getStatus().state).toBe("idle");
  });

  it("assigns work when issues are available and capacity exists", async () => {
    const deps = createMockDeps();
    (deps.issues.fetchReadyIssues as any).mockResolvedValue([
      { number: 42, title: "Fix bug", labels: ["ready"], state: "open", url: "", assignees: [], createdAt: "2024-01-01" },
    ]);
    (deps.issues.prioritize as any).mockImplementation((issues: any[]) => issues);

    const pm = new PMRole(deps);
    pm.start();
    await new Promise((r) => setTimeout(r, 100));
    pm.stop();

    // No longer calls createWorktree — Claude Code handles worktree via -w flag
    expect(deps.developer.spawn).toHaveBeenCalled();
  });

  it("respects dry run mode", async () => {
    const deps = createMockDeps({ dryRun: true });
    (deps.issues.fetchReadyIssues as any).mockResolvedValue([
      { number: 42, title: "Fix bug", labels: ["ready"], state: "open", url: "", assignees: [], createdAt: "2024-01-01" },
    ]);
    (deps.issues.prioritize as any).mockImplementation((issues: any[]) => issues);

    const pm = new PMRole(deps);
    pm.start();
    await new Promise((r) => setTimeout(r, 100));
    pm.stop();

    expect(deps.developer.spawn).not.toHaveBeenCalled();
  });

  it("processes revision_needed messages", async () => {
    const deps = createMockDeps();
    deps.bus.send("cto", "pm", "revision_needed", {
      issue_number: 42,
      pr_number: 10,
      branch: "buffy/issue-42",
      revision_count: 1,
    });

    const pm = new PMRole(deps);
    await pm.runCycle();

    expect(deps.bus.unreadCount("pm")).toBe(0);
  });

  it("detects dead developer sessions", async () => {
    const deps = createMockDeps();
    deps.hr.recordSessionStart({
      project: "test-project",
      role: "developer",
      issue_number: 42,
      tmux_session: "buffy-test-project-dev-42",
      started_at: new Date().toISOString(),
    });

    (deps.tmux.isSessionAlive as any).mockResolvedValue(false);

    const pm = new PMRole(deps);
    await pm.runCycle();

    const active = deps.hr.getActiveSessions("test-project");
    expect(active).toHaveLength(0);
  });

  it("detects completed developers by PR and kills session", async () => {
    const deps = createMockDeps();
    deps.hr.recordSessionStart({
      project: "test-project",
      role: "developer",
      issue_number: 42,
      tmux_session: "buffy-test-project-dev-42",
      worktree_path: "/tmp/repo/.claude/worktrees/issue-42",
      worktree_branch: "fix/issue-42",
      started_at: new Date().toISOString(),
    });

    // Session is still alive (Claude Code waiting for input)
    (deps.tmux.isSessionAlive as any).mockResolvedValue(true);

    // PR exists for the branch
    (deps.prs.findByBranch as any).mockResolvedValue({
      number: 10,
      title: "Fix bug",
      state: "OPEN",
      draft: true,
      labels: ["needs-cto-review"],
      headBranch: "fix/issue-42",
      url: "https://github.com/owner/test-project/pull/10",
      author: "buffy",
    });

    const pm = new PMRole(deps);
    await pm.runCycle();

    // Session should be killed
    expect(deps.tmux.killSession).toHaveBeenCalledWith("buffy-test-project-dev-42");

    // Session record should be ended
    const active = deps.hr.getActiveSessions("test-project");
    expect(active).toHaveLength(0);

    // Worktree should be cleaned up
    expect(deps.worktrees.removeWorktree).toHaveBeenCalledWith({
      path: "/tmp/repo/.claude/worktrees/issue-42",
      branch: "fix/issue-42",
      issueNumber: 42,
    });

    // In-progress label should be removed
    expect(deps.issues.removeLabel).toHaveBeenCalledWith(42, "in-progress");
  });

  it("discovers branch from worktree when not yet known", async () => {
    const deps = createMockDeps();
    deps.hr.recordSessionStart({
      project: "test-project",
      role: "developer",
      issue_number: 42,
      tmux_session: "buffy-test-project-dev-42",
      worktree_path: "/tmp/repo/.claude/worktrees/issue-42",
      // worktree_branch is null — not yet discovered
      started_at: new Date().toISOString(),
    });

    // Session is alive
    (deps.tmux.isSessionAlive as any).mockResolvedValue(true);

    // discoverBranch returns the branch Claude created
    (deps.worktrees.discoverBranch as any).mockResolvedValue("fix/issue-42");

    // PR exists for the discovered branch
    (deps.prs.findByBranch as any).mockResolvedValue({
      number: 10,
      title: "Fix bug",
      state: "OPEN",
      headBranch: "fix/issue-42",
    });

    const pm = new PMRole(deps);
    await pm.runCycle();

    // Should have discovered the branch
    expect(deps.worktrees.discoverBranch).toHaveBeenCalledWith("/tmp/repo/.claude/worktrees/issue-42");

    // Session should be killed (PR was found)
    expect(deps.tmux.killSession).toHaveBeenCalledWith("buffy-test-project-dev-42");
  });

  it("skips issues that already have a worktree on disk", async () => {
    const deps = createMockDeps();
    (deps.issues.fetchReadyIssues as any).mockResolvedValue([
      { number: 42, title: "Fix bug", labels: ["ready"], state: "open", url: "", assignees: [], createdAt: "2024-01-01" },
    ]);
    (deps.issues.prioritize as any).mockImplementation((issues: any[]) => issues);

    // Worktree exists on disk
    (deps.worktrees.worktreeExists as any).mockResolvedValue(true);

    const pm = new PMRole(deps);
    await pm.runCycle();

    // Should NOT spawn a developer
    expect(deps.developer.spawn).not.toHaveBeenCalled();
  });

  it("does not kill session when no PR exists for branch", async () => {
    const deps = createMockDeps();
    deps.hr.recordSessionStart({
      project: "test-project",
      role: "developer",
      issue_number: 42,
      tmux_session: "buffy-test-project-dev-42",
      worktree_path: "/tmp/repo/.claude/worktrees/issue-42",
      worktree_branch: "fix/issue-42",
      started_at: new Date().toISOString(),
    });

    // Session is alive and no PR exists yet
    (deps.tmux.isSessionAlive as any).mockResolvedValue(true);
    (deps.prs.findByBranch as any).mockResolvedValue(null);

    const pm = new PMRole(deps);
    await pm.runCycle();

    // Session should NOT be killed
    expect(deps.tmux.killSession).not.toHaveBeenCalled();

    // Session should still be active
    const active = deps.hr.getActiveSessions("test-project");
    expect(active).toHaveLength(1);
  });

  describe("CTO integration", () => {
    it("spawns CTO when needs-cto-review PRs exist", async () => {
      const deps = createMockDeps();
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [
            { number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: ["needs-cto-review"] },
          ];
        }
        return [];
      });
      (deps.prs.getReviewDecision as any).mockResolvedValue(null);

      const pm = new PMRole(deps);
      await pm.runCycle();

      expect(deps.cto!.spawn).toHaveBeenCalled();
      expect(pm.getStatus().ctoRunning).toBe(true);
    });

    it("does not spawn CTO when already running", async () => {
      const deps = createMockDeps();
      (deps.cto!.isRunning as any).mockResolvedValue(true);
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [{ number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: [] }];
        }
        return [];
      });

      const pm = new PMRole(deps);
      await pm.runCycle();

      expect(deps.cto!.spawn).not.toHaveBeenCalled();
    });

    it("does not spawn CTO in dry run mode", async () => {
      const deps = createMockDeps({ dryRun: true });
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [{ number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: [] }];
        }
        return [];
      });
      (deps.prs.getReviewDecision as any).mockResolvedValue(null);

      const pm = new PMRole(deps);
      await pm.runCycle();

      expect(deps.cto!.spawn).not.toHaveBeenCalled();
    });

    it("handles CTO review outcomes — spawns revision developer on CHANGES_REQUESTED", async () => {
      const deps = createMockDeps();
      // CTO is not running (finished reviewing)
      (deps.cto!.isRunning as any).mockResolvedValue(false);

      // PR still has needs-cto-review label with CHANGES_REQUESTED
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [
            { number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: ["needs-cto-review"] },
          ];
        }
        return [];
      });
      (deps.prs.getReviewDecision as any).mockResolvedValue("CHANGES_REQUESTED");

      const pm = new PMRole(deps);
      await pm.runCycle();

      // Should have removed the label before spawning revision developer
      expect(deps.prs.removeLabel).toHaveBeenCalledWith(10, "needs-cto-review");

      // Should have spawned a revision developer with prNumber
      expect(deps.developer.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          issueNumber: 42,
          prNumber: 10,
        })
      );
    });

    it("flags issue for human after exceeding max revisions", async () => {
      const deps = createMockDeps();
      (deps.cto!.isRunning as any).mockResolvedValue(false);
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [
            { number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: ["needs-cto-review"] },
          ];
        }
        return [];
      });
      (deps.prs.getReviewDecision as any).mockResolvedValue("CHANGES_REQUESTED");

      const pm = new PMRole(deps);

      // Run cycles to exhaust revisions (max_revisions = 2)
      await pm.runCycle();
      // Reset mock to simulate the label being re-added
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [
            { number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: ["needs-cto-review"] },
          ];
        }
        return [];
      });
      await pm.runCycle();

      // Third time should exceed max_revisions (2)
      (deps.prs.listByLabel as any).mockImplementation((label: string) => {
        if (label === "needs-cto-review") {
          return [
            { number: 10, title: "Fix bug", headBranch: "buffy/issue-42", author: "dev", url: "", state: "OPEN", draft: true, labels: ["needs-cto-review"] },
          ];
        }
        return [];
      });
      await pm.runCycle();

      // Should flag for human
      expect(deps.issues.addLabel).toHaveBeenCalledWith(42, "needs-help");
    });

    it("detects dead CTO sessions", async () => {
      const deps = createMockDeps();
      deps.hr.recordSessionStart({
        project: "test-project",
        role: "cto",
        tmux_session: "buffy-test-project-cto",
        started_at: new Date().toISOString(),
      });

      (deps.tmux.isSessionAlive as any).mockResolvedValue(false);

      const pm = new PMRole(deps);
      await pm.runCycle();

      const active = deps.hr.getActiveSessions("test-project");
      expect(active).toHaveLength(0);
      expect(pm.getStatus().ctoRunning).toBe(false);
    });
  });

  describe("extractIssueNumber", () => {
    it("extracts issue number from branch name", () => {
      const pm = new PMRole(createMockDeps());
      expect(pm.extractIssueNumber({ headBranch: "buffy/issue-42" })).toBe(42);
      expect(pm.extractIssueNumber({ headBranch: "fix/issue-142/auth" })).toBe(142);
    });

    it("returns null when no issue number in branch", () => {
      const pm = new PMRole(createMockDeps());
      expect(pm.extractIssueNumber({ headBranch: "feature/auth" })).toBeNull();
      expect(pm.extractIssueNumber({ headBranch: "main" })).toBeNull();
    });
  });
});
