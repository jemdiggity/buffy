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
  prNumber?: number;
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
    let prompt = template
      .replaceAll("{{REPO}}", options.repo)
      .replaceAll("{{ISSUE_NUMBER}}", String(options.issueNumber))
      .replaceAll("{{PR_TITLE_PREFIX}}", options.prTitlePrefix ?? "");

    if (options.prNumber) {
      prompt += this.revisionInstructions(options.prNumber);
    }

    return prompt;
  }

  private revisionInstructions(prNumber: number): string {
    return `

## REVISION MODE

This is a revision of existing PR #${prNumber}. The CTO has requested changes.
You have been loaded with the full PR context via --from-pr.

1. You are already on the PR branch — do NOT create a new branch or PR
2. Address ALL requested changes from the most recent CTO review
3. Run the project's test suite and fix any failures
4. Push your fixes: \`git push\`
5. Re-add the CTO review label: \`gh pr edit ${prNumber} --add-label "needs-cto-review"\``;
  }

  async spawn(options: DeveloperSpawnOptions): Promise<string> {
    const sessionName = devSessionName(options.project, options.issueNumber);
    const prompt = this.buildPrompt(options);

    const env: Record<string, string> = {};
    if (options.ghToken) {
      env.GH_TOKEN = options.ghToken;
    }

    let command: string;
    if (options.prNumber) {
      // Revision: use --from-pr to load PR context (diff, comments, reviews).
      // Claude automatically checks out the PR branch and has full context
      // of what needs fixing.
      command = `claude --from-pr ${options.prNumber} --permission-mode acceptEdits ${this.shellEscape(prompt)}`;
    } else {
      // New work: use -w to create an isolated worktree.
      // Let Claude Code generate the worktree name to avoid branch collisions.
      command = `claude -w --permission-mode acceptEdits ${this.shellEscape(prompt)}`;
    }

    await this.tmux.createSession({
      name: sessionName,
      cwd: options.repoRoot,
      command,
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
