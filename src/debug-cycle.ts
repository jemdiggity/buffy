import { resolve } from "node:path";
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

const projectRoot = resolve(".");
const config = loadConfig(projectRoot);
const projectName = "buffy";
const globalDb = openGlobalDb();
const projectDb = openProjectDb(projectRoot);
const hr = new HRManager(globalDb, { project: projectName, maxProjectSessions: 5, maxTotalSessions: 10, maxDailyCostUsd: 50, estimatedCostPerMinute: 0.15 });
const bus = new CommsBus(projectDb);
const tmux = new TmuxManager();
const worktrees = new WorktreeManager(projectRoot);
const prs = new PRManager(projectRoot);
const issues = new IssueManager(projectRoot);
const developer = new DeveloperRole(tmux);
const pm = new PMRole({ config, hr, bus, tmux, worktrees, prs, issues, developer, projectRoot, dryRun: false, log: (msg) => console.log(msg) });

console.log("Running single cycle...");
await pm.runCycle();
console.log("Cycle complete.");

const sessions = await tmux.listSessions();
console.log("Tmux sessions:", sessions.length ? sessions : "(none)");

globalDb.close();
projectDb.close();
