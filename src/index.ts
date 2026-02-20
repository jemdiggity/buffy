#!/usr/bin/env node

import { resolve } from "node:path";
import { parseFlags } from "./cli/flags.js";
import { initProject } from "./cli/init.js";
import { showStatus, stopAll, showReview, attachSession, showConfig } from "./cli/commands.js";
import { loadConfig } from "./config/index.js";
import { openGlobalDb } from "./hr/index.js";
import { HRManager } from "./hr/index.js";
import { CommsBus } from "./comms/index.js";
import { openProjectDb } from "./hr/db.js";
import { TmuxManager } from "./tmux/index.js";
import { WorktreeManager } from "./git/index.js";
import { PRManager } from "./git/index.js";
import { IssueManager } from "./github/index.js";
import { DeveloperRole } from "./roles/developer.js";
import { PMRole } from "./roles/pm.js";

const VERSION = "0.1.0";

async function main() {
  const flags = parseFlags(process.argv);
  const projectRoot = resolve(".");

  // One-shot commands
  if (flags.init) {
    await initProject(projectRoot);
    return;
  }

  if (flags.status) {
    await showStatus(projectRoot);
    return;
  }

  if (flags.stop) {
    await stopAll(projectRoot, flags.clean);
    return;
  }

  if (flags.review) {
    await showReview(projectRoot);
    return;
  }

  if (flags.attach) {
    await attachSession(projectRoot, flags.attach);
    return;
  }

  if (flags.config === "show") {
    showConfig(projectRoot);
    return;
  }

  // Full orchestrator mode
  const config = loadConfig(projectRoot);
  const projectName = config.project.project.repo.split("/").pop() ?? "unknown";

  const globalDb = openGlobalDb();
  const projectDb = openProjectDb(projectRoot);

  const hr = new HRManager(globalDb, {
    project: projectName,
    maxProjectSessions: config.project.hr.max_concurrent_sessions,
    maxTotalSessions: config.global.hr.max_total_sessions,
    maxDailyCostUsd: config.global.hr.max_cost_per_day_usd,
    estimatedCostPerMinute: config.project.hr.estimated_cost_per_minute,
  });

  const bus = new CommsBus(projectDb);
  const tmux = new TmuxManager();
  const worktrees = new WorktreeManager(projectRoot);

  const ghToken = config.project.project.gh_token_env
    ? process.env[config.project.project.gh_token_env]
    : undefined;

  const prs = new PRManager(projectRoot, ghToken);
  const issues = new IssueManager(projectRoot, ghToken);
  const developer = new DeveloperRole(tmux);

  const pm = new PMRole({
    config,
    hr,
    bus,
    tmux,
    worktrees,
    prs,
    issues,
    developer,
    projectRoot,
    dryRun: flags.dryRun,
    log: (msg) => console.log(msg),
  });

  // Start the PM loop
  pm.start();
  console.log(`Buffy v${VERSION} — ${config.project.project.repo}`);
  console.log(`PM polling every ${config.project.pm.poll_interval_seconds}s`);
  if (flags.dryRun) {
    console.log("DRY RUN MODE — no sessions will be spawned");
  }

  // Try to launch TUI if we have a TTY
  if (process.stdout.isTTY) {
    try {
      const { render } = await import("ink");
      const React = await import("react");
      const { App } = await import("./tui/App.js");

      const { waitUntilExit } = render(
        React.createElement(App, {
          pm,
          hr,
          tmux,
          prs,
          projectName,
          dashboardPort: config.project.dashboard.port,
          onQuit: () => {
            pm.stop();
            globalDb.close();
            projectDb.close();
          },
        })
      );

      await waitUntilExit();
    } catch (err) {
      // Ink may not be available (e.g., in CI), fall back to headless mode
      console.log("TUI not available, running in headless mode. Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          pm.stop();
          globalDb.close();
          projectDb.close();
          resolve();
        });
      });
    }
  } else {
    // Headless mode (no TTY)
    console.log("Running in headless mode. Press Ctrl+C to stop.");
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        pm.stop();
        globalDb.close();
        projectDb.close();
        resolve();
      });
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
