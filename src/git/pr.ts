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

  async isMerged(prNumber: number): Promise<boolean> {
    const pr = await this.getPR(prNumber);
    return pr.state === "MERGED";
  }

  async isClosed(prNumber: number): Promise<boolean> {
    const pr = await this.getPR(prNumber);
    return pr.state === "CLOSED" || pr.state === "MERGED";
  }
}
