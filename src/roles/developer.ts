import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmuxManager } from "../tmux/session.js";
import { devSessionName } from "../tmux/naming.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DeveloperSpawnOptions {
  project: string;
  issueNumber: number;
  repo: string;
  repoRoot: string;
  ghToken?: string;
  prTitlePrefix?: string;
}

export class DeveloperRole {
  private tmux: TmuxManager;

  constructor(tmux?: TmuxManager) {
    this.tmux = tmux ?? new TmuxManager();
  }

  buildPrompt(options: DeveloperSpawnOptions): string {
    const templatePath = join(__dirname, "..", "..", "prompts", "developer.md");
    let template: string;
    try {
      template = readFileSync(templatePath, "utf-8");
    } catch {
      // Fallback inline template if file not found
      template = this.fallbackTemplate();
    }
    return template
      .replaceAll("{{REPO}}", options.repo)
      .replaceAll("{{ISSUE_NUMBER}}", String(options.issueNumber))
      .replaceAll("{{PR_TITLE_PREFIX}}", options.prTitlePrefix ?? "");
  }

  async spawn(options: DeveloperSpawnOptions): Promise<string> {
    const sessionName = devSessionName(options.project, options.issueNumber);
    const prompt = this.buildPrompt(options);

    const env: Record<string, string> = {};
    if (options.ghToken) {
      env.GH_TOKEN = options.ghToken;
    }

    // Use Claude Code's --worktree flag to create and manage the worktree.
    // Worktree goes to <repo>/.claude/worktrees/issue-{N}.
    // Claude handles cleanup on clean exit.
    const worktreeName = `issue-${options.issueNumber}`;

    await this.tmux.createSession({
      name: sessionName,
      cwd: options.repoRoot,
      command: `claude -w ${worktreeName} --permission-mode acceptEdits ${this.shellEscape(prompt)}`,
      env,
    });

    return sessionName;
  }

  async isRunning(project: string, issueNumber: number): Promise<boolean> {
    const sessionName = devSessionName(project, issueNumber);
    return this.tmux.isSessionAlive(sessionName);
  }

  sessionName(project: string, issueNumber: number): string {
    return devSessionName(project, issueNumber);
  }

  private shellEscape(s: string): string {
    // Use single quotes with internal single quotes escaped as '\''
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  private fallbackTemplate(): string {
    return `You are a developer working on the {{REPO}} repository. Your task is to solve GitHub issue #{{ISSUE_NUMBER}}.

## Instructions

1. Read the issue details: \`gh issue view {{ISSUE_NUMBER}}\`
2. Understand the full context of the issue before writing any code
3. Create a feature branch for your work (e.g. \`git checkout -b fix/issue-{{ISSUE_NUMBER}}\`)
4. Create your implementation, following the project's coding conventions
5. Run the project's test suite and fix any failures
6. Push your commits: \`git push -u origin HEAD\`
7. When your work is complete and tests pass, open a draft PR:
   \`\`\`sh
   gh pr create --draft --title "{{PR_TITLE_PREFIX}}fix: <concise description>" --body "Closes #{{ISSUE_NUMBER}}\\n\\n<summary of changes>" --label "needs-cto-review"
   \`\`\`

## Rules

- You are in a git worktree — create your own feature branch before starting work
- Follow the existing code style and patterns
- Do not modify unrelated code
- If you encounter a blocker, open the PR with what you have and add the label \`needs-help\`
- Keep your changes focused on the issue at hand`;
  }
}
