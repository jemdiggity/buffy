import { execa } from "execa";

export interface PRInfo {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  labels: string[];
  headBranch: string;
  url: string;
  author: string;
}

export interface PRReview {
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}

export class PRManager {
  private cwd: string;
  private env: Record<string, string>;

  constructor(cwd: string, ghToken?: string) {
    this.cwd = cwd;
    this.env = ghToken ? { GH_TOKEN: ghToken } : {};
  }

  async listByLabel(label: string): Promise<PRInfo[]> {
    const { stdout } = await execa(
      "gh",
      [
        "pr",
        "list",
        "--label",
        label,
        "--json",
        "number,title,state,isDraft,labels,headRefName,url,author",
        "--limit",
        "100",
      ],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
    const raw = JSON.parse(stdout) as any[];
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.isDraft,
      labels: (pr.labels as any[]).map((l: any) => l.name),
      headBranch: pr.headRefName,
      url: pr.url,
      author: pr.author?.login ?? "unknown",
    }));
  }

  async getPR(prNumber: number): Promise<PRInfo> {
    const { stdout } = await execa(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "number,title,state,isDraft,labels,headRefName,url,author",
      ],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
    const pr = JSON.parse(stdout);
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.isDraft,
      labels: (pr.labels as any[]).map((l: any) => l.name),
      headBranch: pr.headRefName,
      url: pr.url,
      author: pr.author?.login ?? "unknown",
    };
  }

  async getDiff(prNumber: number): Promise<string> {
    const { stdout } = await execa(
      "gh",
      ["pr", "diff", String(prNumber)],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
    return stdout;
  }

  async addLabel(prNumber: number, label: string): Promise<void> {
    await execa(
      "gh",
      ["pr", "edit", String(prNumber), "--add-label", label],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
  }

  async removeLabel(prNumber: number, label: string): Promise<void> {
    await execa(
      "gh",
      ["pr", "edit", String(prNumber), "--remove-label", label],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
  }

  async findByBranch(branch: string): Promise<PRInfo | null> {
    try {
      const { stdout } = await execa(
        "gh",
        [
          "pr",
          "list",
          "--head",
          branch,
          "--state",
          "all",
          "--json",
          "number,title,state,isDraft,labels,headRefName,url,author",
          "--limit",
          "1",
        ],
        { cwd: this.cwd, env: { ...process.env, ...this.env } }
      );
      const raw = JSON.parse(stdout) as any[];
      if (raw.length === 0) return null;
      const pr = raw[0];
      return {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.isDraft,
        labels: (pr.labels as any[]).map((l: any) => l.name),
        headBranch: pr.headRefName,
        url: pr.url,
        author: pr.author?.login ?? "unknown",
      };
    } catch {
      return null;
    }
  }

  async isMerged(prNumber: number): Promise<boolean> {
    const pr = await this.getPR(prNumber);
    return pr.state === "MERGED";
  }

  async isClosed(prNumber: number): Promise<boolean> {
    const pr = await this.getPR(prNumber);
    return pr.state === "CLOSED" || pr.state === "MERGED";
  }

  async getReviewDecision(prNumber: number): Promise<string | null> {
    try {
      const { stdout } = await execa(
        "gh",
        ["pr", "view", String(prNumber), "--json", "reviewDecision"],
        { cwd: this.cwd, env: { ...process.env, ...this.env } }
      );
      const data = JSON.parse(stdout);
      return data.reviewDecision || null;
    } catch {
      return null;
    }
  }

  async getReviews(prNumber: number): Promise<PRReview[]> {
    try {
      const { stdout } = await execa(
        "gh",
        ["pr", "view", String(prNumber), "--json", "reviews"],
        { cwd: this.cwd, env: { ...process.env, ...this.env } }
      );
      const data = JSON.parse(stdout);
      return (data.reviews as any[] ?? []).map((r: any) => ({
        author: r.author?.login ?? "unknown",
        state: r.state,
        body: r.body ?? "",
        submittedAt: r.submittedAt ?? "",
      }));
    } catch {
      return [];
    }
  }

  async mergePR(prNumber: number): Promise<void> {
    await execa(
      "gh",
      ["pr", "merge", String(prNumber), "--squash", "--delete-branch"],
      { cwd: this.cwd, env: { ...process.env, ...this.env } }
    );
  }
}
