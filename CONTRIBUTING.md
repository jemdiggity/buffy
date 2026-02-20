# Contributing to Buffy

## Prerequisites

- Node.js 18+
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- [tmux](https://github.com/tmux/tmux) — `brew install tmux`

## Development Setup

```sh
git clone https://github.com/jemdiggity/buffy.git
cd buffy
npm install
```

## Common Commands

```sh
npm run dev          # Run with tsx
npm test             # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run lint         # Type check (tsc --noEmit)
npm run build        # Compile to standalone binary
```

## Running Tests

Tests use [vitest](https://vitest.dev/) with globals enabled. Test files live next to source files with a `.test.ts` suffix.

```sh
npm test                        # Run all tests
npx vitest run src/config/      # Run tests in a specific directory
```

When writing tests:

- Use in-memory SQLite (`:memory:`) for database tests
- Use temporary directories for file system tests — clean up in `afterEach`
- Keep tests focused and fast

## Submitting a PR

1. Create a branch off `main`
2. Make your changes
3. Run `npm test` and `npm run lint` — both must pass
4. Open a pull request against `main`

Keep PRs focused on a single issue or change.

## Code Style

- TypeScript with strict mode — no `any` unless unavoidable
- Use the existing module patterns: each feature area has an `index.ts` barrel export
- Prefer structured return types over thrown exceptions
- SQLite databases use WAL mode

## Project Layout

```
src/
├── cli/        # CLI entry and commands
├── comms/      # SQLite-backed message bus
├── config/     # TOML config loading and schema
├── git/        # Worktree and PR management
├── github/     # GitHub API interactions (via gh CLI)
├── hr/         # HR Manager — budget tracking, capacity checks
├── roles/      # PM, CTO, and Developer implementations
├── tmux/       # Tmux session management
└── tui/        # React + Ink terminal UI
```
