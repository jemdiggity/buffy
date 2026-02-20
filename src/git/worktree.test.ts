import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeManager } from "./worktree.js";

describe("WorktreeManager", () => {
  let tmpDir: string;
  let repoDir: string;
  let manager: WorktreeManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "buffy-git-test-"));
    repoDir = join(tmpDir, "repo");

    // Create a real git repo with an initial commit
    execSync(`mkdir -p "${repoDir}" && cd "${repoDir}" && git init && git checkout -b main && echo "initial" > README.md && git add . && git commit -m "initial"`, {
      stdio: "pipe",
    });

    manager = new WorktreeManager(repoDir, join(tmpDir, "worktrees"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates correct branch names", () => {
    expect(manager.branchName(42)).toBe("buffy/issue-42");
    expect(manager.branchName(1)).toBe("buffy/issue-1");
  });

  it("generates correct worktree paths", () => {
    const path = manager.worktreePath(42);
    expect(path).toContain("issue-42");
  });

  it("creates and removes worktrees", async () => {
    const info = await manager.createWorktree(42, "main");
    expect(info.branch).toBe("buffy/issue-42");
    expect(info.issueNumber).toBe(42);

    const exists = await manager.worktreeExists(42);
    expect(exists).toBe(true);

    const worktrees = await manager.listWorktrees();
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]!.issueNumber).toBe(42);

    await manager.removeWorktree(42);
    const existsAfter = await manager.worktreeExists(42);
    expect(existsAfter).toBe(false);
  });

  it("removeAll cleans up everything", async () => {
    await manager.createWorktree(1, "main");
    await manager.createWorktree(2, "main");

    const count = await manager.removeAll();
    expect(count).toBe(2);

    const remaining = await manager.listWorktrees();
    expect(remaining).toHaveLength(0);
  });
});
