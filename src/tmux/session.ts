import { execa } from "execa";

export interface CreateSessionOptions {
  name: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
}

export class TmuxManager {
  async createSession(options: CreateSessionOptions): Promise<void> {
    const args = ["new-session", "-d", "-s", options.name, "-c", options.cwd];

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    // Unset CLAUDECODE so nested Claude Code sessions can start
    args.push(`unset CLAUDECODE; ${options.command}`);
    await execa("tmux", args);
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execa("tmux", ["list-sessions", "-F", "#{session_name}"]);
      return stdout.split("\n").filter(Boolean);
    } catch {
      // tmux returns error when no server is running
      return [];
    }
  }

  async listBuffySessions(project?: string): Promise<string[]> {
    const sessions = await this.listSessions();
    const prefix = project ? `buffy-${project}-` : "buffy-";
    return sessions.filter((s) => s.startsWith(prefix));
  }

  async sessionExists(name: string): Promise<boolean> {
    try {
      await execa("tmux", ["has-session", "-t", name]);
      return true;
    } catch {
      return false;
    }
  }

  async killSession(name: string): Promise<void> {
    try {
      await execa("tmux", ["kill-session", "-t", name]);
    } catch {
      // Session may already be dead
    }
  }

  async killAllBuffySessions(project?: string): Promise<number> {
    const sessions = await this.listBuffySessions(project);
    for (const session of sessions) {
      await this.killSession(session);
    }
    return sessions.length;
  }

  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await execa("tmux", ["send-keys", "-t", sessionName, keys, "Enter"]);
  }

  async capturePane(sessionName: string, lines?: number): Promise<string> {
    const args = ["capture-pane", "-t", sessionName, "-p"];
    if (lines) {
      args.push("-S", `-${lines}`);
    }
    const { stdout } = await execa("tmux", args);
    return stdout;
  }

  async isSessionAlive(name: string): Promise<boolean> {
    return this.sessionExists(name);
  }

  async autoAcceptTrust(sessionName: string, delayMs: number = 2000): Promise<void> {
    // Wait for Claude Code to render the workspace trust prompt, then send Enter
    // to accept the default "Yes, I trust this folder" option.
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await execa("tmux", ["send-keys", "-t", sessionName, "Enter"]);
    } catch {
      // Session may have exited or trust was already accepted
    }
  }
}
