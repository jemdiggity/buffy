import { loadConfig } from "../config/index.js";
import { TmuxManager } from "../tmux/index.js";
import { WorktreeManager } from "../git/index.js";
import { PRManager } from "../git/index.js";
import { LABELS } from "../github/index.js";
import { HRManager } from "../hr/index.js";
import { openGlobalDb } from "../hr/index.js";

export async function showStatus(projectRoot: string): Promise<void> {
  const config = loadConfig(projectRoot);
  const tmux = new TmuxManager();
  const projectName = config.project.project.repo.split("/").pop() ?? "unknown";

  const sessions = await tmux.listBuffySessions(projectName);

  console.log(`Buffy Status — ${config.project.project.repo}`);
  console.log("─".repeat(50));

  if (sessions.length === 0) {
    console.log("No active sessions");
  } else {
    console.log(`Active sessions (${sessions.length}):`);
    for (const session of sessions) {
      console.log(`  ${session}`);
    }
  }

  try {
    const db = openGlobalDb();
    const hr = new HRManager(db, {
      project: projectName,
      maxProjectSessions: config.project.hr.max_concurrent_sessions,
      maxTotalSessions: config.global.hr.max_total_sessions,
      maxDailyCostUsd: config.global.hr.max_cost_per_day_usd,
      estimatedCostPerMinute: config.project.hr.estimated_cost_per_minute,
    });
    const snapshot = hr.getBudgetSnapshot();
    console.log(`\nBudget:`);
    console.log(`  Sessions: ${snapshot.activeProjectSessions}/${snapshot.maxProjectSessions} (project), ${snapshot.activeTotalSessions}/${snapshot.maxTotalSessions} (global)`);
    console.log(`  Est. cost today: $${snapshot.estimatedDailyCostUsd.toFixed(2)}/$${snapshot.maxDailyCostUsd.toFixed(2)}`);
    db.close();
  } catch {
    // DB may not exist yet
  }
}

export async function stopAll(projectRoot: string, clean: boolean): Promise<void> {
  const config = loadConfig(projectRoot);
  const tmux = new TmuxManager();
  const projectName = config.project.project.repo.split("/").pop() ?? "unknown";

  const killed = await tmux.killAllBuffySessions(projectName);
  console.log(`Stopped ${killed} session(s)`);

  if (clean) {
    const worktrees = new WorktreeManager(projectRoot);
    const removed = await worktrees.removeAll();
    console.log(`Removed ${removed} worktree(s)`);
  }
}

export async function showReview(projectRoot: string): Promise<void> {
  const config = loadConfig(projectRoot);

  const ghToken = config.project.project.gh_token_env
    ? process.env[config.project.project.gh_token_env]
    : undefined;
  const prs = new PRManager(projectRoot, ghToken);

  try {
    const approved = await prs.listByLabel(LABELS.CTO_APPROVED);
    if (approved.length === 0) {
      console.log("No CTO-approved PRs awaiting review");
      return;
    }
    console.log(`CTO-Approved PRs (${approved.length}):`);
    for (const pr of approved) {
      console.log(`  #${pr.number}  ${pr.title}  (${pr.headBranch})`);
    }
  } catch (err) {
    console.error("Failed to fetch PRs:", err instanceof Error ? err.message : err);
  }
}

export async function attachSession(projectRoot: string, session: string): Promise<void> {
  const config = loadConfig(projectRoot);
  const projectName = config.project.project.repo.split("/").pop() ?? "unknown";

  // If user gave a short name like "pm", expand it
  let fullName = session;
  if (!session.startsWith("buffy-")) {
    if (session === "pm") fullName = `buffy-${projectName}-pm`;
    else if (session === "cto") fullName = `buffy-${projectName}-cto`;
    else if (session.startsWith("dev-")) fullName = `buffy-${projectName}-${session}`;
    else fullName = `buffy-${projectName}-${session}`;
  }

  const { execaSync } = await import("execa");
  try {
    execaSync("tmux", ["attach-session", "-t", fullName], { stdio: "inherit" });
  } catch {
    console.error(`Could not attach to session: ${fullName}`);
  }
}

export function showConfig(projectRoot: string): void {
  const config = loadConfig(projectRoot);
  console.log(JSON.stringify(config, null, 2));
}
