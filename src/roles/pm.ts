import type { BuffyConfig } from "../config/index.js";
import { HRManager } from "../hr/index.js";
import { CommsBus } from "../comms/index.js";
import type { RevisionNeededPayload, SessionEndedPayload } from "../comms/index.js";
import { TmuxManager } from "../tmux/index.js";
import { WorktreeManager } from "../git/index.js";
import { PRManager } from "../git/index.js";
import { IssueManager } from "../github/index.js";
import { LABELS } from "../github/index.js";
import { DeveloperRole } from "./developer.js";

export interface PMStatus {
  state: "idle" | "polling" | "spawning" | "cleaning";
  lastPollAt?: string;
  activeDevelopers: number;
  issuesInQueue: number;
  prsAwaitingCTO: number;
  prsAwaitingHuman: number;
  errors: string[];
}

export interface PMDependencies {
  config: BuffyConfig;
  hr: HRManager;
  bus: CommsBus;
  tmux: TmuxManager;
  worktrees: WorktreeManager;
  prs: PRManager;
  issues: IssueManager;
  developer: DeveloperRole;
  projectRoot: string;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

export class PMRole {
  private deps: PMDependencies;
  private status: PMStatus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: PMDependencies) {
    this.deps = deps;
    this.status = {
      state: "idle",
      activeDevelopers: 0,
      issuesInQueue: 0,
      prsAwaitingCTO: 0,
      prsAwaitingHuman: 0,
      errors: [],
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log("PM starting...");

    this.runCycle().catch((err) => this.logError("Cycle error", err));

    const interval = this.deps.config.project.pm.poll_interval_seconds * 1000;
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => this.logError("Cycle error", err));
    }, interval);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.state = "idle";
    this.log("PM stopped");
  }

  getStatus(): PMStatus {
    return { ...this.status };
  }

  async runCycle(): Promise<void> {
    this.log("Starting cycle...");

    try {
      this.status.state = "polling";
      this.status.lastPollAt = new Date().toISOString();

      await this.processMessages();
      await this.checkCompletedSessions();
      await this.checkDeveloperCompletion();

      this.status.state = "spawning";
      await this.assignNewWork();

      this.status.state = "idle";
      this.log("Cycle complete");
    } catch (err) {
      this.logError("runCycle failed", err);
      this.status.state = "idle";
    }
  }

  private async processMessages(): Promise<void> {
    const messages = this.deps.bus.poll("pm");

    for (const msg of messages) {
      switch (msg.type) {
        case "revision_needed": {
          const payload = msg.payload as unknown as RevisionNeededPayload;
          this.log(`Revision needed for issue #${payload.issue_number} (PR #${payload.pr_number})`);
          await this.spawnRevisionDeveloper(payload);
          break;
        }
        case "session_ended": {
          const payload = msg.payload as unknown as SessionEndedPayload;
          this.log(`Session ended: ${payload.tmux_session} (success: ${payload.success})`);
          break;
        }
        case "review_complete": {
          this.log(`Review complete: ${JSON.stringify(msg.payload)}`);
          break;
        }
        default:
          this.log(`Unknown message type: ${msg.type}`);
      }
      this.deps.bus.markRead(msg.id);
    }
  }

  private async checkCompletedSessions(): Promise<void> {
    const projectName = this.getProjectName();
    const sessions = this.deps.hr.getActiveSessions(projectName);

    for (const session of sessions) {
      if (session.role !== "developer") continue;

      const alive = await this.deps.tmux.isSessionAlive(session.tmux_session);
      if (!alive) {
        this.log(`Developer session ${session.tmux_session} has ended`);
        if (session.id != null) {
          this.deps.hr.recordSessionEnd(session.id);
        }
        if (session.issue_number) {
          try {
            await this.deps.issues.removeLabel(session.issue_number, LABELS.IN_PROGRESS);
          } catch {
            // Label may already be removed
          }
        }

        // Clean up the worktree — branch is on the remote now
        if (session.worktree_path && session.worktree_branch) {
          try {
            await this.deps.worktrees.removeWorktree({
              path: session.worktree_path,
              branch: session.worktree_branch,
              issueNumber: session.issue_number!,
            });
            this.log(`Removed worktree for issue #${session.issue_number}`);
          } catch {
            // Non-fatal
          }
        }
      }
    }
  }

  private async checkDeveloperCompletion(): Promise<void> {
    const projectName = this.getProjectName();
    const sessions = this.deps.hr.getActiveSessions(projectName);

    for (const session of sessions) {
      if (session.role !== "developer") continue;
      if (!session.worktree_branch) continue;

      // Skip sessions that are already dead (handled by checkCompletedSessions)
      const alive = await this.deps.tmux.isSessionAlive(session.tmux_session);
      if (!alive) continue;

      // Check if a PR exists for this branch — if so, the developer is done
      const pr = await this.deps.prs.findByBranch(session.worktree_branch);
      if (!pr) continue;

      this.log(`Developer session ${session.tmux_session} has opened PR #${pr.number}, cleaning up`);

      await this.deps.tmux.killSession(session.tmux_session);

      if (session.id != null) {
        this.deps.hr.recordSessionEnd(session.id);
      }

      if (session.issue_number) {
        try {
          await this.deps.issues.removeLabel(session.issue_number, LABELS.IN_PROGRESS);
        } catch {
          // Label may already be removed
        }
      }

      if (session.worktree_path && session.worktree_branch) {
        try {
          await this.deps.worktrees.removeWorktree({
            path: session.worktree_path,
            branch: session.worktree_branch,
            issueNumber: session.issue_number!,
          });
          this.log(`Removed worktree for issue #${session.issue_number}`);
        } catch {
          // Non-fatal
        }
      }
    }
  }

  private async assignNewWork(): Promise<void> {
    const config = this.deps.config.project;

    const backpressure = await this.checkBackpressure();
    if (backpressure) {
      this.log(`Backpressure active: ${backpressure}`);
      return;
    }

    let issues;
    try {
      issues = await this.deps.issues.fetchReadyIssues(config.pm.issue_filter);
      this.log(`Fetched ${issues.length} ready issue(s)`);
    } catch (err) {
      this.logError("Failed to fetch issues", err);
      return;
    }

    // Filter out issues that already have an active session
    const activeSessions = this.deps.hr.getActiveSessions(this.getProjectName());
    const activeIssueNumbers = new Set(
      activeSessions.filter((s) => s.issue_number != null).map((s) => s.issue_number)
    );

    this.log(`Active issues: [${[...activeIssueNumbers]}]`);

    issues = issues.filter((i) => !activeIssueNumbers.has(i.number));

    // Filter out issues that already have a buffy PR open
    const filtered: typeof issues = [];
    for (const issue of issues) {
      const branch = this.deps.worktrees.branchName(issue.number);
      const existingPR = await this.deps.prs.findByBranch(branch);
      if (existingPR) {
        this.log(`Issue #${issue.number} already has PR #${existingPR.number}, skipping`);
        continue;
      }
      filtered.push(issue);
    }
    issues = filtered;

    this.log(`After filtering: ${issues.length} issue(s) to assign`);

    issues = this.deps.issues.prioritize(issues);
    this.status.issuesInQueue = issues.length;

    for (const issue of issues) {
      const capacity = this.deps.hr.canSpawn();
      if (!capacity.canSpawn) {
        this.log(`Cannot spawn: ${capacity.reason}`);
        break;
      }

      this.log(`Assigning issue #${issue.number}: ${issue.title}`);
      await this.spawnDeveloper(issue.number);
    }

    this.status.activeDevelopers = this.deps.hr.getActiveSessions(this.getProjectName())
      .filter((s) => s.role === "developer").length;
  }

  private async spawnDeveloper(issueNumber: number): Promise<void> {
    const config = this.deps.config.project;
    const projectName = this.getProjectName();

    if (this.deps.dryRun) {
      this.log(`[DRY RUN] Would spawn developer for issue #${issueNumber}`);
      return;
    }

    try {
      const wtInfo = await this.deps.worktrees.createWorktree(
        issueNumber,
        config.project.default_branch
      );

      try {
        await this.deps.issues.markInProgress(issueNumber);
      } catch {
        // Non-fatal
      }

      const ghToken = config.project.gh_token_env
        ? process.env[config.project.gh_token_env]
        : undefined;

      const sessionName = await this.deps.developer.spawn({
        project: projectName,
        issueNumber,
        repo: config.project.repo,
        worktreePath: wtInfo.path,
        branch: wtInfo.branch,
        ghToken,
      });

      this.deps.hr.recordSessionStart({
        project: projectName,
        role: "developer",
        issue_number: issueNumber,
        tmux_session: sessionName,
        worktree_path: wtInfo.path,
        worktree_branch: wtInfo.branch,
        started_at: new Date().toISOString(),
      });

      this.log(`Spawned developer session: ${sessionName}`);
    } catch (err) {
      this.logError(`Failed to spawn developer for issue #${issueNumber}`, err);
    }
  }

  // TODO: Consider using `claude --from-pr {pr_number}` for revisions instead
  // of spawning a fresh developer. This resumes context from the PR, so the
  // developer already knows the review feedback without re-reading everything.
  private async spawnRevisionDeveloper(payload: RevisionNeededPayload): Promise<void> {
    const config = this.deps.config.project;

    if (payload.revision_count >= config.cto.max_revisions) {
      this.log(`Issue #${payload.issue_number} exceeded max revisions (${payload.revision_count}/${config.cto.max_revisions}), flagging for human`);
      try {
        await this.deps.issues.addLabel(payload.issue_number, LABELS.NEEDS_HELP);
      } catch {
        // Non-fatal
      }
      return;
    }

    await this.spawnDeveloper(payload.issue_number);
  }

  private async checkBackpressure(): Promise<string | null> {
    const config = this.deps.config.project;

    try {
      const awaitingCTO = await this.deps.prs.listByLabel(LABELS.NEEDS_CTO_REVIEW);
      this.status.prsAwaitingCTO = awaitingCTO.length;
      if (awaitingCTO.length >= config.backpressure.max_prs_awaiting_cto) {
        return `${awaitingCTO.length} PRs awaiting CTO review (limit: ${config.backpressure.max_prs_awaiting_cto})`;
      }
    } catch {
      // If we can't check, don't block
    }

    try {
      const awaitingHuman = await this.deps.prs.listByLabel(LABELS.CTO_APPROVED);
      this.status.prsAwaitingHuman = awaitingHuman.length;
      if (awaitingHuman.length >= config.backpressure.max_prs_awaiting_human) {
        return `${awaitingHuman.length} PRs awaiting human review (limit: ${config.backpressure.max_prs_awaiting_human})`;
      }
    } catch {
      // If we can't check, don't block
    }

    return null;
  }

  private getProjectName(): string {
    const repo = this.deps.config.project.project.repo;
    return repo.split("/").pop() ?? repo;
  }

  private log(msg: string): void {
    if (this.deps.log) {
      this.deps.log(`[PM] ${msg}`);
    }
  }

  private logError(msg: string, err: unknown): void {
    const errorMsg = err instanceof Error ? err.message : String(err);
    this.status.errors.push(`${msg}: ${errorMsg}`);
    if (this.status.errors.length > 20) {
      this.status.errors = this.status.errors.slice(-20);
    }
    this.log(`ERROR: ${msg}: ${errorMsg}`);
  }
}
