import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeManager } from "./worktree.js";

describe("WorktreeManager", () => {
  let tmpDir: string;
  let repoDir: string;
  let manager: WorktreeManager;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "buffy-git-test-")));
    repoDir = join(tmpDir, "repo");

    // Create a real git repo with an initial commit
    execSync(`mkdir -p "${repoDir}" && cd "${repoDir}" && git init && git checkout -b main && echo "initial" > README.md && git add . && git commit -m "initial"`, {
      stdio: "pipe",
    });

    manager = new WorktreeManager(repoDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates correct Claude worktree paths", () => {
    const path = manager.claudeWorktreePath(42);
    expect(path).toBe(join(repoDir, ".claude", "worktrees", "issue-42"));
  });

  it("discovers branch in a worktree", async () => {
    // Create a worktree manually to test discoverBranch
    const wtPath = join(repoDir, ".claude", "worktrees", "issue-42");
    execSync(`cd "${repoDir}" && git worktree add -b test-branch "${wtPath}" main`, {
      stdio: "pipe",
    });

    const branch = await manager.discoverBranch(wtPath);
    expect(branch).toBe("test-branch");

    // Cleanup
    execSync(`cd "${repoDir}" && git worktree remove "${wtPath}"`, { stdio: "pipe" });
  });

  it("returns null for non-existent worktree path", async () => {
    const branch = await manager.discoverBranch("/nonexistent/path");
    expect(branch).toBeNull();
  });

  it("lists worktrees in .claude/worktrees/issue-* pattern", async () => {
    // Create a worktree at the Claude Code path
    const wtPath = manager.claudeWorktreePath(42);
    execSync(`cd "${repoDir}" && git worktree add -b test-branch "${wtPath}" main`, {
      stdio: "pipe",
    });

    const worktrees = await manager.listWorktrees();
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]!.issueNumber).toBe(42);
    expect(worktrees[0]!.branch).toBe("test-branch");
    expect(worktrees[0]!.path).toBe(wtPath);

    // Cleanup
    execSync(`cd "${repoDir}" && git worktree remove "${wtPath}"`, { stdio: "pipe" });
  });

  it("worktreeExists checks both disk and git", async () => {
    expect(await manager.worktreeExists(42)).toBe(false);

    const wtPath = manager.claudeWorktreePath(42);
    execSync(`cd "${repoDir}" && git worktree add -b test-branch "${wtPath}" main`, {
      stdio: "pipe",
    });

    expect(await manager.worktreeExists(42)).toBe(true);

    // Cleanup
    execSync(`cd "${repoDir}" && git worktree remove "${wtPath}"`, { stdio: "pipe" });
  });

  it("removeAll cleans up everything", async () => {
    const wt1 = manager.claudeWorktreePath(1);
    const wt2 = manager.claudeWorktreePath(2);
    execSync(`cd "${repoDir}" && git worktree add -b branch-1 "${wt1}" main && git worktree add -b branch-2 "${wt2}" main`, {
      stdio: "pipe",
    });

    const count = await manager.removeAll();
    expect(count).toBe(2);

    const remaining = await manager.listWorktrees();
    expect(remaining).toHaveLength(0);
  });
});
