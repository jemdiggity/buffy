# Buffy

AI Software Development Team Orchestrator — manages a team of Claude Code instances like a software company.

Buffy assigns GitHub issues to AI developers, reviews their PRs through an AI CTO, and batches approved work for human review. The goal is to minimize human context switching by consolidating the human-in-the-loop to focused review sessions.

The name comes from Steve Yegge's "AI Vampire" essay — Buffy slays the vampire by organizing your Claude army so they don't drain your energy and judgment.

## How It Works

```
GitHub issue exists
  → PM picks it from the queue
  → PM checks HR: do we have capacity?
  → PM spawns a Developer session (Claude Code in a git worktree)
  → Developer codes, tests, opens a draft PR
  → CTO reviews the diff
  → CTO approves → PR batched for human review
  → Human sits down, reviews a batch of CTO-approved PRs
```

Everything bills against your Claude Max subscription via the `claude` CLI — no API keys needed.

## The Org Chart

```
Human (CEO)
  └── PM — fetches issues, prioritizes, assigns work, applies backpressure
  └── CTO — reviews draft PRs, gates what reaches the human
  └── HR Manager — monitors token/session budget, controls capacity
  └── Developers — one per issue, fully independent, ephemeral
```

## Install

```sh
# From source
git clone https://github.com/jemdiggity/buffy.git
cd buffy
npm install
```

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) with an active Max subscription
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- [tmux](https://github.com/tmux/tmux) — `brew install tmux`
- Node.js 18+

## Quick Start

```sh
# Initialize in your project repo
cd your-project
npx tsx /path/to/buffy/src/index.ts --init

# Edit the generated config
vim buffy.toml

# Start (dry run first to verify)
npx tsx /path/to/buffy/src/index.ts --dry-run

# Start for real
npx tsx /path/to/buffy/src/index.ts
```

## CLI

```
buffy                    # Launch TUI (starts everything, shows status)
buffy --init             # Create buffy.toml, labels, .buffy/ dir
buffy --status           # Print status once and exit
buffy --review           # List CTO-approved PRs
buffy --stop             # Kill all running buffy sessions
buffy --stop --clean     # Kill sessions and remove worktrees
buffy --attach pm        # Attach directly to a tmux session
buffy --config show      # Print current config
buffy --dry-run          # Launch without spawning sessions
```

## Configuration

### Per-project: `buffy.toml`

```toml
[project]
repo = "owner/repo"
default_branch = "main"

[pm]
poll_interval_seconds = 300
issue_filter = "is:open is:issue label:ready"
max_concurrent_developers = 3

[cto]
poll_interval_seconds = 120
max_revisions = 2

[hr]
max_concurrent_sessions = 5
estimated_cost_per_minute = 0.15

[backpressure]
max_prs_awaiting_cto = 5
max_prs_awaiting_human = 3

[night_shift]
enabled = false
start_hour = 1
end_hour = 6
```

### Global: `~/.config/buffy/config.toml`

```toml
[hr]
max_total_sessions = 10
max_cost_per_day_usd = 50.00
```

## GitHub Labels

Buffy uses labels to track pipeline state. `buffy --init` creates them automatically.

| Label | Meaning |
|-------|---------|
| `ready` | Issue is ready to be picked up |
| `in-progress` | A developer session is working on it |
| `needs-cto-review` | PR waiting for CTO review |
| `cto-approved` | PR passed review, awaiting human |
| `needs-help` | Developer couldn't solve it |

## Architecture

- **TypeScript** throughout — same ecosystem as Claude Code
- **tmux** for all Claude sessions (attachable, debuggable, survives disconnects)
- **SQLite** for state (comms bus, HR budget tracking) — no contention under concurrency
- **`claude` CLI** (not the SDK) — bills against Max subscription via OAuth
- **`gh` CLI** for all GitHub operations
- **React + Ink** for the terminal UI

## Development

```sh
npm install
npm run dev          # Run with tsx
npm test             # Run tests (vitest)
npm run lint         # Type check (tsc --noEmit)
```

## License

MIT
