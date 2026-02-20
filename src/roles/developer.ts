import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmuxManager } from "../tmux/session.js";
import { devSessionName } from "../tmux/naming.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DeveloperSpawnOptions {
  project: string;
  issueNumber: number;
  repo: string;
  worktreePath: string;
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

    // Write prompt to a temp file to avoid shell escaping issues with backticks/quotes
    const promptDir = join(options.worktreePath, ".buffy");
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, "prompt.md");
    writeFileSync(promptFile, prompt);

    const env: Record<string, string> = {};
    if (options.ghToken) {
      env.GH_TOKEN = options.ghToken;
    }

    await this.tmux.createSession({
      name: sessionName,
      cwd: options.worktreePath,
      // Interactive mode (no -p flag) so the session is attachable via tmux.
      // Permission prompts are visible and answerable if a human attaches.
      // .claude/settings.json pre-approves common tools automatically.
      command: `claude --permission-mode acceptEdits "$(cat ${promptFile})"`,
      env,
    });

    // Auto-accept the workspace trust prompt (defaults to "Yes, I trust this folder")
    await this.tmux.autoAcceptTrust(sessionName);

    return sessionName;
  }

  async isRunning(project: string, issueNumber: number): Promise<boolean> {
    const sessionName = devSessionName(project, issueNumber);
    return this.tmux.isSessionAlive(sessionName);
  }

  sessionName(project: string, issueNumber: number): string {
    return devSessionName(project, issueNumber);
  }

  private fallbackTemplate(): string {
    return `You are a developer working on the {{REPO}} repository. Your task is to solve GitHub issue #{{ISSUE_NUMBER}}.

## Instructions

1. Read the issue details: \`gh issue view {{ISSUE_NUMBER}}\`
2. Understand the full context of the issue before writing any code
3. Create your implementation, following the project's coding conventions
4. Run the project's test suite and fix any failures
5. When your work is complete and tests pass, open a draft PR:
   \`\`\`sh
   gh pr create --draft --title "{{PR_TITLE_PREFIX}}fix: <concise description>" --body "Closes #{{ISSUE_NUMBER}}\\n\\n<summary of changes>" --label "needs-cto-review"
   \`\`\`

## Rules

- Follow the existing code style and patterns
- Write tests for new functionality when the project has a test framework
- Do not modify unrelated code
- If you encounter a blocker, open the PR with what you have and add the label \`needs-help\`
- Keep your changes focused on the issue at hand`;
  }
}
