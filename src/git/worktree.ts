import simpleGit, { type SimpleGit } from "simple-git";
import { resolve, join, basename } from "node:path";
import { existsSync } from "node:fs";

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
    // Find a unique path and branch name (don't clobber existing worktrees)
    const { path, branch } = this.findAvailableSlot(issueNumber);

    // Fetch latest from remote
    try {
      await this.git.fetch("origin", baseBranch);
    } catch {
      // May fail if no remote, continue anyway
    }

    // Check if branch already exists (from a previous run)
    const branches = await this.git.branch();
    const branchExists = branches.all.includes(branch);

    if (branchExists) {
      await this.git.raw(["worktree", "add", path, branch]);
    } else {
      try {
        await this.git.raw(["worktree", "add", "-b", branch, path, `origin/${baseBranch}`]);
      } catch {
        await this.git.raw(["worktree", "add", "-b", branch, path, baseBranch]);
      }
    }

    return { path, branch, issueNumber };
  }

  private findAvailableSlot(issueNumber: number): { path: string; branch: string } {
    const basePath = this.worktreePath(issueNumber);
    const baseBranch = this.branchName(issueNumber);

    if (!existsSync(basePath)) {
      return { path: basePath, branch: baseBranch };
    }

    // Someone's already there — find a free suffix
    for (let i = 2; i <= 100; i++) {
      const path = join(this.worktreeBaseDir, `issue-${issueNumber}-${i}`);
      if (!existsSync(path)) {
        return { path, branch: `buffy/issue-${issueNumber}-${i}` };
      }
    }

    throw new Error(`Too many worktrees for issue #${issueNumber}`);
  }

  async removeWorktree(worktree: WorktreeInfo): Promise<void> {
    const name = basename(worktree.path);
    await this.git.raw(["worktree", "remove", name]);

    try {
      await this.git.branch(["-D", worktree.branch]);
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

      // Only include buffy worktrees (issue-123 or issue-123-2)
      const match = branch.match(/^buffy\/issue-(\d+)(-\d+)?$/);
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
      await this.removeWorktree(wt);
    }
    return worktrees.length;
  }
}
