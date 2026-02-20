import simpleGit, { type SimpleGit } from "simple-git";
import { resolve, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";

export interface WorktreeInfo {
  path: string;
  branch: string;
  issueNumber: number;
}

export class WorktreeManager {
  private git: SimpleGit;
  private repoRoot: string;

  constructor(repoRoot: string) {
    const resolved = resolve(repoRoot);
    // Use realpath to follow symlinks (e.g. /tmp → /private/tmp on macOS)
    // so paths match what `git worktree list` outputs
    this.repoRoot = existsSync(resolved) ? realpathSync(resolved) : resolved;
    this.git = simpleGit(this.repoRoot);
  }

  /**
   * Returns the path Claude Code's --worktree flag uses for a given issue.
   * Path: <repoRoot>/.claude/worktrees/issue-{N}
   */
  claudeWorktreePath(issueNumber: number): string {
    return join(this.repoRoot, ".claude", "worktrees", `issue-${issueNumber}`);
  }

  /**
   * Discovers the current branch in a worktree directory.
   * Used to find the branch name after Claude creates it.
   */
  async discoverBranch(worktreePath: string): Promise<string | null> {
    if (!existsSync(worktreePath)) return null;
    try {
      const git = simpleGit(worktreePath);
      const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
      return branch.trim() || null;
    } catch {
      return null;
    }
  }

  async removeWorktree(worktree: WorktreeInfo): Promise<void> {
    try {
      await this.git.raw(["worktree", "remove", "--force", worktree.path]);
    } catch {
      // Worktree may already be removed
    }

    if (worktree.branch) {
      try {
        await this.git.branch(["-D", worktree.branch]);
      } catch {
        // Branch may not exist
      }
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await this.git.raw(["worktree", "list", "--porcelain"]);
    const worktrees: WorktreeInfo[] = [];
    const entries = result.split("\n\n").filter(Boolean);

    const claudeWorktreePrefix = join(this.repoRoot, ".claude", "worktrees", "issue-");

    for (const entry of entries) {
      const lines = entry.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (!pathLine) continue;

      const path = pathLine.slice("worktree ".length);

      // Only include buffy worktrees managed by Claude's -w flag
      if (!path.startsWith(claudeWorktreePrefix)) continue;

      const branch = branchLine ? branchLine.slice("branch refs/heads/".length) : "";

      // Extract issue number from path: .claude/worktrees/issue-{N}
      const match = path.match(/issue-(\d+)$/);
      if (match) {
        worktrees.push({
          path,
          branch,
          issueNumber: parseInt(match[1]!, 10),
        });
      }
    }

    return worktrees;
  }

  async worktreeExists(issueNumber: number): Promise<boolean> {
    const path = this.claudeWorktreePath(issueNumber);
    if (!existsSync(path)) return false;
    // Also verify git knows about it
    const worktrees = await this.listWorktrees();
    return worktrees.some((w) => w.issueNumber === issueNumber);
  }

  async removeAll(): Promise<number> {
    const worktrees = await this.listWorktrees();
    for (const wt of worktrees) {
      await this.removeWorktree(wt);
    }
    return worktrees.length;
  }
}
