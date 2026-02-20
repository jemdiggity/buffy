import simpleGit, { type SimpleGit } from "simple-git";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

export interface WorktreeInfo {
  path: string;
  branch: string;
  issueNumber: number;
}

export class WorktreeManager {
  private git: SimpleGit;
  private repoRoot: string;
  private worktreeBaseDir: string;

  constructor(repoRoot: string, worktreeDir: string = "../.buffy-worktrees") {
    this.repoRoot = resolve(repoRoot);
    this.worktreeBaseDir = resolve(repoRoot, worktreeDir);
    this.git = simpleGit(this.repoRoot);
  }

  branchName(issueNumber: number): string {
    return `buffy/issue-${issueNumber}`;
  }

  worktreePath(issueNumber: number): string {
    return join(this.worktreeBaseDir, `issue-${issueNumber}`);
  }

  async createWorktree(issueNumber: number, baseBranch: string = "main"): Promise<WorktreeInfo> {
    const branch = this.branchName(issueNumber);
    const path = this.worktreePath(issueNumber);

    // Fetch latest from remote
    try {
      await this.git.fetch("origin", baseBranch);
    } catch {
      // May fail if no remote, continue anyway
    }

    // Create the worktree with a new branch from the base
    await this.git.raw([
      "worktree",
      "add",
      "-b",
      branch,
      path,
      `origin/${baseBranch}`,
    ]).catch(async () => {
      // If origin/baseBranch doesn't exist, try local baseBranch
      await this.git.raw(["worktree", "add", "-b", branch, path, baseBranch]);
    });

    return { path, branch, issueNumber };
  }

  async removeWorktree(issueNumber: number): Promise<void> {
    const path = this.worktreePath(issueNumber);

    try {
      await this.git.raw(["worktree", "remove", path, "--force"]);
    } catch {
      // If worktree remove fails, try manual cleanup
      if (existsSync(path)) {
        await rm(path, { recursive: true, force: true });
        await this.git.raw(["worktree", "prune"]);
      }
    }

    // Delete the branch
    const branch = this.branchName(issueNumber);
    try {
      await this.git.branch(["-D", branch]);
    } catch {
      // Branch may not exist
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await this.git.raw(["worktree", "list", "--porcelain"]);
    const worktrees: WorktreeInfo[] = [];
    const entries = result.split("\n\n").filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (!pathLine || !branchLine) continue;

      const path = pathLine.slice("worktree ".length);
      const branch = branchLine.slice("branch refs/heads/".length);

      // Only include buffy worktrees
      const match = branch.match(/^buffy\/issue-(\d+)$/);
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
    const worktrees = await this.listWorktrees();
    return worktrees.some((w) => w.issueNumber === issueNumber);
  }

  async removeAll(): Promise<number> {
    const worktrees = await this.listWorktrees();
    for (const wt of worktrees) {
      await this.removeWorktree(wt.issueNumber);
    }
    return worktrees.length;
  }
}
