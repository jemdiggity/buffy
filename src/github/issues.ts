import { execa } from "execa";
import { LABELS } from "./labels.js";

export interface GitHubIssue {
  number: number;
  title: string;
  labels: string[];
  state: string;
  url: string;
  assignees: string[];
  milestone?: string;
  createdAt: string;
}

export class IssueManager {
  private cwd: string;
  private env: Record<string, string>;

  constructor(cwd: string, ghToken?: string) {
    this.cwd = cwd;
    this.env = ghToken ? { GH_TOKEN: ghToken } : {};
  }

  async fetchReadyIssues(filter?: string): Promise<GitHubIssue[]> {
    const searchFilter = filter ?? "is:open is:issue label:ready";
    const { stdout } = await execa(
      "gh",
      [
        "issue",
        "list",
        "--search",
        searchFilter,
        "--json",
        "number,title,labels,state,url,assignees,milestone,createdAt",
        "--limit",
        "50",
      ],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );

    const raw = JSON.parse(stdout) as any[];
    return raw.map((issue) => ({
      number: issue.number,
      title: issue.title,
      labels: (issue.labels as any[]).map((l: any) => l.name),
      state: issue.state,
      url: issue.url,
      assignees: (issue.assignees as any[]).map((a: any) => a.login),
      milestone: issue.milestone?.title,
      createdAt: issue.createdAt,
    }));
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const { stdout } = await execa(
      "gh",
      [
        "issue",
        "view",
        String(issueNumber),
        "--json",
        "number,title,labels,state,url,assignees,milestone,createdAt",
      ],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );

    const issue = JSON.parse(stdout);
    return {
      number: issue.number,
      title: issue.title,
      labels: (issue.labels as any[]).map((l: any) => l.name),
      state: issue.state,
      url: issue.url,
      assignees: (issue.assignees as any[]).map((a: any) => a.login),
      milestone: issue.milestone?.title,
      createdAt: issue.createdAt,
    };
  }

  async addLabel(issueNumber: number, label: string): Promise<void> {
    await execa(
      "gh",
      ["issue", "edit", String(issueNumber), "--add-label", label],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await execa(
      "gh",
      ["issue", "edit", String(issueNumber), "--remove-label", label],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
  }

  async markInProgress(issueNumber: number): Promise<void> {
    await this.addLabel(issueNumber, LABELS.IN_PROGRESS);
  }

  async clearInProgress(issueNumber: number): Promise<void> {
    await this.removeLabel(issueNumber, LABELS.IN_PROGRESS);
  }

  prioritize(issues: GitHubIssue[]): GitHubIssue[] {
    // Simple priority: issues with milestones first, then by creation date (oldest first)
    return [...issues].sort((a, b) => {
      if (a.milestone && !b.milestone) return -1;
      if (!a.milestone && b.milestone) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }
}
