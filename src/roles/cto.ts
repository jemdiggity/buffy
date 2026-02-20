import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmuxManager } from "../tmux/index.js";
import { ctoSessionName } from "../tmux/naming.js";
import { PRManager } from "../git/index.js";
import type { PRInfo } from "../git/index.js";
import { LABELS } from "../github/index.js";
import { CommsBus } from "../comms/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CTOSpawnOptions {
  project: string;
  repo: string;
  cwd: string;
  ghToken?: string;
}

export class CTORole {
  private tmux: TmuxManager;

  constructor(tmux?: TmuxManager) {
    this.tmux = tmux ?? new TmuxManager();
  }

  buildPrompt(repo: string, prs: PRInfo[]): string {
    const templatePath = join(__dirname, "..", "..", "prompts", "cto.md");
    let template: string;
    try {
      template = readFileSync(templatePath, "utf-8");
    } catch {
      template = this.fallbackTemplate();
    }

    const prList = prs
      .map((pr) => `- **PR #${pr.number}**: ${pr.title} (branch: \`${pr.headBranch}\`)`)
      .join("\n");

    return template
      .replaceAll("{{REPO}}", repo)
      .replaceAll("{{PR_LIST}}", prList)
      .replaceAll("{{PR_NUMBER}}", prs.map((p) => String(p.number)).join(", "));
  }

  async spawn(options: CTOSpawnOptions, prs: PRInfo[]): Promise<string> {
    const sessionName = ctoSessionName(options.project);
    const prompt = this.buildPrompt(options.repo, prs);

    // Write prompt to a temp file to avoid shell escaping issues
    const promptDir = join(options.cwd, ".buffy");
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, "cto-prompt.md");
    writeFileSync(promptFile, prompt);

    const env: Record<string, string> = {};
    if (options.ghToken) {
      env.GH_TOKEN = options.ghToken;
    }

    await this.tmux.createSession({
      name: sessionName,
      cwd: options.cwd,
      command: `claude --dangerously-skip-permissions -p "$(cat ${promptFile})"`,
      env,
    });

    return sessionName;
  }

  async isRunning(project: string): Promise<boolean> {
    const sessionName = ctoSessionName(project);
    return this.tmux.isSessionAlive(sessionName);
  }

  sessionName(project: string): string {
    return ctoSessionName(project);
  }

  private fallbackTemplate(): string {
    return `You are the CTO reviewing pull requests for the {{REPO}} repository.

## PRs to Review

{{PR_LIST}}

## For Each PR

1. View the PR diff: \`gh pr diff <number>\`
2. Review for correctness, quality, security, tests, consistency

### If the PR is good:
\`\`\`sh
gh pr review <number> --approve --body "CTO Review: Approved. <summary>"
gh pr edit <number> --remove-label "needs-cto-review" --add-label "cto-approved"
\`\`\`

### If changes are needed:
\`\`\`sh
gh pr review <number> --request-changes --body "CTO Review: Changes needed.\\n\\n<feedback>"
\`\`\``;
  }
}
