# Buffy — AI Software Development Team Orchestrator

## Vision

Buffy is an open-source orchestrator that manages a team of Claude Code instances like a software company. It assigns GitHub issues to AI developers, reviews their PRs through an AI CTO, and batches approved work for human review. The goal is to minimize human context switching by consolidating the human-in-the-loop to focused review sessions. The name comes from Steve Yegge's "AI Vampire" essay — Buffy slays the vampire by organizing your Claude army so they don't drain your energy and judgment.

This project is inspired by Gas Town (steveyegge/gastown) but takes a different approach: instead of a flat Mayor → Polecats model, Buffy uses a layered org structure where AI roles filter and batch work before it reaches the human.

## Architecture

### The Org Chart

```
Human (CEO)
  └── PM — fetches GitHub issues, prioritizes, assigns work, applies backpressure
  └── CTO — reviews draft PRs, gates what reaches the human
  └── HR Manager — monitors token/session budget, controls capacity (pure code, no LLM)
  └── Developers — one per issue, fully independent, ephemeral
```

### Roles

**PM (Project Manager)** — Long-lived Claude Code session in tmux.
- Periodically fetches open GitHub issues (via `gh` CLI)
- Prioritizes issues (by labels, milestones, or explicit human ranking)
- Checks with HR Manager before spawning developers
- Labels assigned issues `in-progress` on GitHub (`gh issue edit --add-label in-progress`) so human devs can see what the robots are working on
- Removes `in-progress` label when PR is merged/closed
- Monitors PR pipeline and applies backpressure: if PRs are piling up awaiting CTO or human review, stops assigning new work
- Assigns issues to developers by spawning new sessions
- Cleans up worktrees and branches for merged/closed PRs
- Supports night shift mode (see below)

**CTO** — Ephemeral Claude Code session in tmux, spawned one-shot per batch by the PM.
- PM detects PRs labeled `needs-cto-review` and spawns a CTO session to review the batch
- Reviews diffs for quality, correctness, consistency, security
- Approves: relabels PR from `needs-cto-review` to `cto-approved` via `gh pr edit`
- Requests changes: leaves label, posts review via `gh pr review --request-changes`
- CTO session dies after reviewing the batch

**HR Manager** — Pure TypeScript module, no LLM. Imported directly by the PM (`hr.canSpawn()`, `hr.recordSession()`, etc.). Reads/writes SQLite for budget state. The dashboard reads the same database for budget display. Not a separate process — just a library.
- Tracks active sessions and estimated costs (wall-clock × cost-per-minute)
- Enforces configurable budgets (max concurrent sessions per-project, global session cap, global daily cost cap)
- Exposes capacity checks for the PM before spawning
- Monitors burn rate and projects weekly usage for night shift decisions

**Developer** — Ephemeral Claude Code session in tmux. One per issue.
- PM spawns `claude -w issue-{N} --permission-mode acceptEdits "prompt"` from the repo root
- Claude Code's `--worktree` flag creates a worktree at `<repo>/.claude/worktrees/issue-{N}` and handles cleanup on clean exit
- Developer creates its own feature branch, does the work autonomously (reads issue via `gh`, writes code, runs tests)
- Opens a draft PR with label `needs-cto-review` when done
- Session dies after PR is opened
- For revisions: PM spawns developer with `prNumber` context, developer checks out existing PR branch via `gh pr checkout`, reads review comments, pushes fixes, and re-adds `needs-cto-review` label

### The Developer Workflow

Every developer (human or AI) follows the same flow:
```
GitHub issue → git worktree (feature branch) → do work → open PR
```

The orchestrator doesn't invent a new workflow. It manages who gets assigned, when they start, and what happens to the PR.

### Work Lifecycle

```
GitHub issue exists in the repo
  → PM picks it from the queue based on priority
  → PM asks HR Manager: do we have capacity?
  → HR Manager checks: active sessions, budget, burn rate
  → If yes: PM spawns a Developer session
  → Developer: creates feature branch, codes, runs tests, opens draft PR with `needs-cto-review`
  → Developer session dies, PM cleans up worktree
  → PM detects `needs-cto-review` PRs, spawns CTO session with the batch
  → CTO reviews each PR:
      - Approves → relabels to `cto-approved`
      - Requests changes → leaves `needs-cto-review` label, posts review
  → CTO session dies
  → PM detects rejected PRs (label still `needs-cto-review` + CHANGES_REQUESTED review decision)
  → PM removes `needs-cto-review` label, spawns revision Developer with PR context
  → Revision Developer: checks out PR branch, reads review comments, fixes, pushes, re-adds `needs-cto-review`
  → Repeat until approved or max_revisions exceeded (flagged `needs-help`)
  → Human opens `buffy` TUI, sees batch of `cto-approved` PRs
  → Human reviews diff + CTO summary, approves (squash merge) or opens in GitHub for changes
```

### Backpressure

The PM regulates flow based on pipeline state:
```
Can I assign the next issue?
  1. Are there issues ready to work? (gh issue list)
  2. Does HR say I have capacity? (sessions + budget)
  3. Is the PR pipeline backed up?
     - How many PRs awaiting CTO review?
     - How many PRs awaiting human review?
     - If either exceeds threshold, pause spawning
```

When the pipeline drains (human reviews, CTO catches up), PM automatically resumes.

### Night Shift

Max plan usage resets on a weekly rolling window. If the PM detects that the current week's usage is well under the limit (i.e., not on track to hit the weekly cap), it can enter "night shift" mode during configurable off-hours to burn through the issue backlog while the human sleeps.

```
Night shift logic:
  1. Is it within the configured night shift window? (e.g., 1am–6am)
  2. Fetch real usage from Anthropic OAuth API (7-day + 5-hour utilization %)
     Falls back to session-minutes estimation if API unavailable
  3. What % of the week has elapsed?
  4. If 5-hour utilization > 80%, block (short-term backpressure)
  5. If weekly usage_percent < elapsed_percent (i.e., headroom exists), spawn developers
  6. Throttle spawning to stay under projected weekly cap
  7. Stop if usage approaches the configured safety margin
```

This is what makes Max 20x actually worth $200/month — the robots work while you sleep, burning quota that would otherwise go to waste. Configurable via the `[night_shift]` section in `buffy.toml`.

## Tech Stack

- **Language:** TypeScript (same ecosystem as Claude Code itself, which is built with TypeScript/React/Ink/Bun)
- **Claude Code:** All roles spawned via `claude` CLI in tmux (bills against Max subscription via OAuth). The SDK (`@anthropic-ai/claude-code`) is NOT used for spawning — it requires API key auth and bills separately from Max.
- **Runtime:** Node.js with tsx for development
- **GitHub:** `gh` CLI for all GitHub operations. Per-project auth via `GH_TOKEN` environment variable injected into each tmux session (avoids global `gh auth switch` races between concurrent projects)
- **Git:** simple-git for worktree discovery and cleanup (Claude Code's `-w` flag handles worktree creation)
- **Process management:** tmux for all Claude sessions. Each gets a named session: `buffy-{project}-pm`, `buffy-{project}-cto`, `buffy-{project}-dev-{issue}`
- **State:** better-sqlite3 — per-project `.buffy/state.db` for comms bus, global `~/.config/buffy/hr.db` for HR budget tracking across projects
- **Dashboard server:** Hono (lightweight, fast, no bloat)
- **Dashboard frontend:** Vanilla HTML/CSS/JS, no framework, no build step
- **Terminal in browser:** xterm.js + node-pty over WebSocket for attaching to any tmux session from the dashboard
- **Config:** TOML for project/role configuration
- **TUI:** React + Ink (same paradigm as Claude Code itself — reactive terminal UI). ink-table, ink-spinner, chalk for styling
- **Build:** bun build --compile (standalone binary, no Node.js required for end users)
- **Distribution:** curl install script + GitHub releases (macOS arm64/x64, Linux x64/arm64). Homebrew as alternative.

## Project Structure

```
buffy/                             # The npm package
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # CLI entry point
│   ├── cli/                       # CLI entry point and flag handling
│   │   └── flags.ts               # --init, --status, --stop, --attach, etc.
│   ├── tui/                       # React + Ink TUI components
│   │   ├── App.tsx                # Main TUI app — layout, keybindings, state
│   │   ├── StatusView.tsx         # Live-updating roles, pipeline, budget, night shift
│   │   ├── ReviewView.tsx         # PR review: diff, CTO summary, approve/reject
│   │   ├── AttachPicker.tsx       # Session picker for attaching to tmux sessions
│   │   └── components/            # Shared: tables, spinners, panels, key hints
│   ├── roles/
│   │   ├── pm.ts                  # PM: issue fetching, prioritization, spawning
│   │   ├── cto.ts                 # CTO: PR review, approval, batching
│   │   └── developer.ts           # Developer: spawn claude in worktree with prompt
│   ├── hr/
│   │   ├── manager.ts             # Budget tracking, capacity checks (no LLM)
│   │   ├── db.ts                  # SQLite schema and queries (local + global)
│   │   └── types.ts               # Budget, SessionSnapshot, etc.
│   ├── git/
│   │   ├── worktree.ts            # Worktree discovery, cleanup, path helpers (creation via Claude -w flag)
│   │   └── pr.ts                  # PR creation, status checking
│   ├── github/
│   │   ├── issues.ts              # Fetch and filter issues
│   │   └── labels.ts              # Label conventions: ready, in-progress, needs-cto-review, cto-approved, needs-help
│   ├── tmux/
│   │   ├── session.ts             # Create, attach, destroy, list tmux sessions
│   │   └── naming.ts              # Session naming: buffy-{project}-{role}-{id}
│   ├── comms/
│   │   ├── bus.ts                 # Inter-role communication (SQLite-backed message queue)
│   │   └── types.ts               # Message types
│   ├── dashboard/
│   │   ├── server.ts              # Hono server: REST API + static files
│   │   ├── pty.ts                 # WebSocket + node-pty bridge for xterm.js terminal
│   │   ├── index.ts               # Barrel export
│   │   └── public/
│   │       ├── index.html         # Dashboard: status overview, PR pipeline, budget
│   │       ├── terminal.html      # Terminal view: xterm.js session attach
│   │       ├── style.css          # Dark theme (Tokyo Night inspired)
│   │       └── app.js             # Vanilla JS: poll /api/status, render DOM
│   ├── nightshift/
│   │   ├── types.ts               # NightShiftState, UsageSnapshot, SpawnDecision
│   │   ├── usage.ts               # WeeklyUsageTracker: real API data + session-minutes fallback
│   │   ├── scheduler.ts           # NightShiftScheduler: window check, headroom, spawn decision
│   │   └── index.ts               # Barrel export
│   ├── usage/
│   │   ├── types.ts               # UsageWindow, ClaudeUsageData (API response types)
│   │   ├── credentials.ts         # OAuth token retrieval (Keychain, file, env var)
│   │   ├── client.ts              # UsageClient: fetch from Anthropic OAuth API with caching
│   │   └── index.ts               # Barrel export
│   └── config/
│       ├── schema.ts              # TOML config types (local + global)
│       └── defaults.ts            # Default configuration values
├── prompts/                       # Editable prompt templates (outside src for easy tweaking)
│   ├── pm.md
│   ├── cto.md
│   └── developer.md
└── README.md
```

**State created at runtime (per project repo):**
```
your-repo/
├── buffy.toml                     # Project config (checked into repo or .gitignored)
└── .buffy/
    └── state.db                   # SQLite: comms bus, project state
```

**Global state:**
```
~/.config/buffy/
├── config.toml                    # Global config (budget caps, session limits)
└── hr.db                          # SQLite: HR budget tracking across all projects
```

## Configuration

**Per-project: `buffy.toml` (in repo root)**

```toml
[project]
repo = "owner/repo"
default_branch = "main"
gh_token_env = "GH_TOKEN_MYAPP"   # Environment variable holding the GitHub token for this project

[pm]
poll_interval_seconds = 300       # How often PM checks for new issues
issue_filter = "is:open is:issue label:ready"
max_concurrent_developers = 3

[cto]
poll_interval_seconds = 120       # How often CTO checks for new PRs
review_label = "needs-cto-review"
approved_label = "cto-approved"
max_revisions = 2                 # Max CTO rejection cycles before flagging for human

[hr]
max_concurrent_sessions = 5       # Per-project hard cap on Claude sessions
estimated_cost_per_minute = 0.15  # For MVP cost estimation

[backpressure]
max_prs_awaiting_cto = 5
max_prs_awaiting_human = 3

[dashboard]
port = 3000

[night_shift]
enabled = false
start_hour = 1                    # 1am local time
end_hour = 6                      # 6am local time
safety_margin_percent = 15        # Stop if projected to use >85% of weekly limit
weekly_session_minutes_limit = 600 # 10 hours of session time per rolling week
max_concurrent_developers = 5     # Elevated from PM's default 3 during night shift
```

**Global: `~/.config/buffy/config.toml`**

```toml
[hr]
max_total_sessions = 10           # Hard cap across ALL projects
max_cost_per_day_usd = 50.00
throttle_at_percent = 80
```

## CLI

Buffy is a TUI-first application. Running `buffy` launches everything (PM, CTO, dashboard) and displays a live-updating status screen. Quitting the TUI (`q`) gracefully shuts everything down.

### Install

```
curl -fsSL https://buffy.dev/install.sh | sh
```

### The Main TUI

```
$ buffy
╭─────────────────────────────────────────────────────╮
│  🧛 Buffy v0.1.0 — myapp                           │
│  Dashboard: http://localhost:3000                   │
╰─────────────────────────────────────────────────────╯

  Roles                          Pipeline
  ● PM      polling (3m ago)     PRs awaiting CTO:    2
  ● CTO     reviewing #47       PRs awaiting human:  1
  ○ Dev #142 coding (12m)        PRs merged today:    4
  ○ Dev #155 opening PR...

  Budget                         Night Shift
  Sessions: 3/5                  Status: idle
  Weekly usage: 34%              Next window: 1:00am
  Est. cost today: $18.20        Projected: safe

  ┌─ Ready for Review ──────────────────────────────┐
  │  ▸ PR #47  fix: auth token refresh   (cto: ✓)  │
  │    PR #43  feat: webhook retry logic (cto: ✓)  │
  └─────────────────────────────────────────────────┘

  [r] review PR  [g] open in GitHub  [↑↓] navigate
  [a] attach to session  [d] dashboard  [q] quit
```

### Keybindings

| Key | Action |
|-----|--------|
| `↑↓` | Navigate PR list and session list |
| `r` | Review selected PR (inline diff + CTO summary) |
| `g` | Open selected PR in browser via `gh pr view --web` |
| `a` | Session picker — select a role/developer to attach to its tmux session |
| `Esc` | Return to main view (from attach, review, or any sub-screen) |
| `d` | Open dashboard in browser |
| `q` | Graceful shutdown — stop all sessions, clean up, exit |

### Flags (for scripting / fire-and-forget)

```
buffy                    # Launch TUI (starts everything, shows status, stops on quit)
buffy --init             # Create buffy.toml, labels, .buffy/ dir
buffy --status           # Print status once and exit (no TUI)
buffy --review           # List CTO-approved PRs and exit
buffy --stop             # Kill all running buffy sessions
buffy --attach pm        # Attach directly to a session (no TUI)
buffy --logs dev-142     # Tail logs without attaching
buffy --config show      # Print current config
buffy --dry-run          # Launch but don't spawn sessions or touch GitHub
```

## Communication Protocol

Roles communicate via a SQLite-backed message queue (not Git, to avoid contention under concurrency).

Messages table:
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  type TEXT NOT NULL,        -- 'spawn_request', 'capacity_check', 'pr_ready', 'review_complete', 'alert', etc.
  payload TEXT NOT NULL,     -- JSON
  created_at TEXT NOT NULL,
  read_at TEXT
);
```

Each role polls its inbox on its loop interval. This is simple, debuggable, and has no contention issues.

## Tmux Session Naming

```
buffy-{project}-pm              # PM session
buffy-{project}-cto             # CTO session  
buffy-{project}-dev-{issue}     # Developer sessions (e.g., buffy-myapp-dev-142)
```

`{project}` is derived from the repo name. All sessions are prefixed with `buffy-` so `tmux ls | grep buffy-` shows the full fleet across all projects.

## GitHub Labels

Buffy uses labels to track pipeline state. Human devs working in the same repo can see at a glance what the robots are doing.

| Label | Applied by | Meaning |
|-------|-----------|---------|
| `ready` | Human | Issue is ready to be picked up by the PM |
| `in-progress` | PM | A developer session is working on this issue |
| `needs-cto-review` | Developer | PR is open and waiting for CTO review |
| `cto-approved` | CTO | PR passed CTO review, awaiting human |
| `needs-help` | Developer/PM | Developer couldn't solve it, needs human attention |

PM removes `in-progress` when the PR is merged or closed. `buffy --init` creates these labels in the repo if they don't exist.

## Dashboard

The dashboard is a vanilla web app served by Hono:

**Status page (index.html):**
- Active roles and their status (PM: polling, CTO: reviewing PR #143, etc.)
- Developer table: issue number, branch, status (coding/testing/opening PR), duration
- PR pipeline: PRs awaiting CTO review, PRs awaiting human review, recently merged
- HR budget: sessions active / max, estimated cost today, burn rate

**Terminal page (terminal.html):**
- Uses xterm.js connected via WebSocket to node-pty
- Click any role or developer from the status page to open their live terminal
- Full interactive terminal — you can type, scroll, see Claude Code working

**No build step.** Static HTML/CSS/JS served from `src/dashboard/public/`. xterm.js loaded from CDN.

## Key Design Decisions

1. **SQLite over Git for communication.** Gas Town uses Beads (JSON in Git) for inter-agent messaging, which causes contention under high concurrency. SQLite handles concurrent reads/writes cleanly.

2. **Tmux for all sessions.** Every Claude instance runs in a named tmux session. This enables monitoring (attach/detach), debugging (during development), and resilience (sessions survive terminal disconnects).

3. **HR Manager is pure code, not an LLM.** Using an LLM to count tokens is wasteful. Budget tracking is deterministic logic.

4. **Backpressure is built in.** The PM monitors the downstream pipeline and throttles spawning when PRs are piling up. The system self-regulates: speeds up when the human is reviewing, slows down when they're away.

5. **Prompts are external files.** Role prompts live in `/prompts/*.md` so they can be tweaked without touching code. This is the part that will be iterated on most.

6. **One developer per issue.** No team leads, no task decomposition. A single developer takes an issue from branch to PR. This keeps the system simple and each unit of work independent.

7. **TUI-first.** Running `buffy` is the entire interface — it starts everything, shows live status, handles review, attaches to sessions, and shuts down on quit. Flags (`--status`, `--stop`, etc.) exist for scripting. Built with React + Ink, same paradigm Claude Code uses.

8. **TypeScript throughout.** Same ecosystem as Claude Code itself. One language for orchestrator + TUI + dashboard. Compiled to standalone binary via Bun for zero-dependency distribution.

## Resolved Architectural Questions

### 1. How developers receive instructions

The PM spawns `claude -w issue-{N} --permission-mode acceptEdits "prompt"` from the repo root. Claude Code's `--worktree` flag creates a worktree at `<repo>/.claude/worktrees/issue-{N}`, branching from the default remote branch. Claude Code automatically picks up the repo's `CLAUDE.md` and `.claude/` config from the worktree. The initial prompt tells the developer its issue number; it uses `gh issue view` to get full context. The developer creates its own feature branch within the worktree — the branch name is Claude's choice, discovered later by the PM via `git rev-parse --abbrev-ref HEAD` for PR detection and cleanup.

### 2. Claude CLI in tmux (not the SDK)

**tmux + `claude` CLI is the only option for Max plan users.** The Claude Agent SDK requires API key authentication and bills against API credits, not your Max subscription. Only the `claude` CLI authenticates via OAuth and bills against Max quota. All roles are spawned by running `claude` inside named tmux sessions (developers use `claude -w` for worktree management, other roles use `claude -p`). This preserves full attachability for debugging and ensures everything bills against a single Max subscription.

### 3. CTO "request changes" loop

Uses GitHub labels as signals — no bus dependency for the review loop:
1. Developer opens PR with `needs-cto-review` label
2. PM detects `needs-cto-review` PRs, spawns CTO session with the batch
3. CTO approves → relabels to `cto-approved`. CTO rejects → leaves label, posts review via `gh pr review --request-changes`
4. CTO session dies
5. PM detects rejected PRs: label still `needs-cto-review` + `reviewDecision === "CHANGES_REQUESTED"` (via `gh pr view --json reviewDecision`)
6. PM removes `needs-cto-review` label (prevents re-processing stale state), spawns revision developer with `prNumber` context
7. Revision developer: checks out PR branch via `gh pr checkout`, reads review comments via `gh pr view --comments`, fixes, pushes, re-adds `needs-cto-review`
8. Next PM cycle: detects `needs-cto-review` again, spawns CTO → repeat

Max retries configurable in `buffy.toml` (default: 2). PM tracks revision count per PR. After max retries, issue is flagged for human attention with `needs-help` label.

### 4. How the CTO discovers new PRs

The PM discovers PRs needing review: `gh pr list --label needs-cto-review`. When fresh PRs exist (no `CHANGES_REQUESTED` review decision), the PM spawns an ephemeral CTO session with the batch. The CTO does not poll — it is spawned on-demand by the PM.

### 5. Token tracking

**Real usage data via OAuth API:** Buffy fetches actual utilization percentages from `GET https://api.anthropic.com/api/oauth/usage` using Claude Code's stored OAuth credentials. This returns 5-hour and 7-day rolling window utilization as percentages (0-100). The `src/usage/` module handles credential retrieval (macOS Keychain, `~/.claude/.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN` env var), API calls with caching (60s TTL), and 401 retry with token refresh.

**Night shift uses real data:** The 7-day utilization drives night shift headroom calculations (replacing the session-minutes estimation). The 5-hour utilization acts as an additional backpressure signal — if > 80%, spawning is blocked regardless of weekly headroom. The TUI and dashboard show whether data comes from "API" or "estimated" (fallback).

**Fallback:** If the API is unreachable or credentials are unavailable, the system falls back to session-minutes estimation from HR's SQLite (wall-clock duration × cost-per-minute). The `UsageSnapshot.source` field ("api" | "estimated") tells callers which data they got.

**Important: Max plan and the SDK.** The Claude Agent SDK (`@anthropic-ai/claude-code`) requires API key authentication and does NOT bill against your Max subscription. Only the `claude` CLI uses Max quota via OAuth. This is why Buffy uses tmux + `claude` CLI for all roles — everything bills against your Max plan. Do not use the SDK for spawning sessions unless you want separate API charges.

### 6. Worktrees and cleanup

**Worktree path:** `<repo>/.claude/worktrees/issue-{number}` (managed by Claude Code's `-w` flag)
- Branch naming is Claude's choice within the worktree (e.g., `fix/issue-142`, `feat/add-auth`)
- PM discovers the branch via `git rev-parse --abbrev-ref HEAD` in the worktree directory

**Cleanup:** Claude Code auto-cleans worktrees on clean session exit. PM handles remaining cleanup:
- Dead session with worktree still on disk → PM removes worktree and branch
- PR merged/closed → PM removes worktree and branch on next poll cycle
- `buffy --stop --clean` → remove all worktrees

### 7. Multi-project support

Buffy supports multiple projects running simultaneously:

**Per-project (lives in each repo):**
- `buffy.toml` — project config (issues, labels, backpressure thresholds)
- `.buffy/state.db` — SQLite for comms bus and project-level state
- Worktrees in `.claude/worktrees/` (managed by Claude Code's `-w` flag)

**Global (shared across all projects):**
- `~/.config/buffy/config.toml` — global settings (API budget cap, global session limit)
- `~/.config/buffy/hr.db` — SQLite for HR budget tracking across all projects

**Session naming:** `buffy-{project}-pm`, `buffy-{project}-cto`, `buffy-{project}-dev-{issue}` where `{project}` is derived from the repo name. `tmux ls | grep buffy-` shows all sessions across all projects.

**HR checks both scopes** before approving a spawn:
- Local: project's `max_concurrent_developers` not exceeded
- Global: total sessions across all projects under global cap, daily spend under global budget

## Development Notes

- Use `tsx` for running TypeScript directly during development
- Use `bun build --compile` to produce standalone binaries per platform (macOS arm64/x64, Linux x64/arm64)
- The CLI entry point parses flags (--status, --stop, etc.) for fire-and-forget mode, otherwise launches the Ink TUI
- All tmux operations are just shelling out to the `tmux` CLI via execa
- PM spawns `claude -w issue-{N} --permission-mode acceptEdits "prompt"` in a new tmux session with cwd set to the repo root. Claude Code's `-w` flag creates the worktree and picks up the repo's CLAUDE.md and .claude/ config automatically.
- All Claude sessions use the `claude` CLI (not the SDK) to bill against Max subscription
- Each tmux session gets `GH_TOKEN` injected from the project config so `gh` commands authenticate to the correct GitHub account
- The dashboard starts alongside the PM on `buffy` launch, serves REST API (`/api/status`, `/api/sessions`) and static files, with WebSocket terminal attachment via node-pty
- The dashboard is shut down gracefully on TUI quit or SIGINT
- Project name for session naming is derived from the repo directory name

## Testing

### Testing Buffy itself

- **Unit tests:** HR Manager (budget math, capacity checks, multi-project accounting), tmux module (session naming, create/destroy), git module (worktree paths, branch discovery, cleanup), comms bus (message routing, polling), config parsing (TOML → typed config)
- **Integration tests:** Use a test repo. Spawn a developer, verify worktree created, branch exists, PR opened with correct labels. Test PM → HR → Developer flow end-to-end. Test CTO rejection → new developer cycle.
- **Dry-run mode:** `buffy --dry-run` logs what it would do without spawning sessions or touching GitHub. Useful for validating config and prompt changes.
- **Test framework:** vitest (fast, TypeScript-native, good for both unit and integration)

### Testing that AI developers produce

The developer prompt instructs Claude Code to run the project's test suite before opening a PR. This is steered entirely by the prompt — "run the project's tests, fix any failures, only open the PR when tests pass." Claude Code already does this well when instructed. The project's own CLAUDE.md can specify the test command (e.g., `npm test`, `cargo test`).

## What to Build First (MVP)

1. **HR Manager module** — budget tracking, capacity checks, SQLite setup
2. **Tmux module** — create, list, attach, destroy named sessions
3. **Git module** — worktree path helpers, branch discovery, cleanup
4. **Developer role** — spawn a Claude Code session in a worktree for a single issue, open a PR when done
5. **PM role** — fetch issues, check capacity, label issues, spawn developers, cleanup
6. **TUI** — main status view with Ink, keybindings, session attach picker
7. **CTO role** — watch for PRs, review, approve/reject
8. **Review view** — inline PR review in the TUI
9. **Dashboard** — web status page, then terminal attachment
10. **Night shift** — usage checking, off-hours scheduling

Test end-to-end with a single issue before scaling to multiple concurrent developers.