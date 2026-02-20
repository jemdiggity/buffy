import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const SESSIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  role TEXT NOT NULL,
  issue_number INTEGER,
  tmux_session TEXT NOT NULL,
  worktree_path TEXT,
  worktree_branch TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  estimated_cost_usd REAL
);

CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
`;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function openGlobalDb(dbPath?: string): Database.Database {
  const path = dbPath ?? join(homedir(), ".config", "buffy", "hr.db");
  ensureDir(path);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SESSIONS_SCHEMA);
  return db;
}

export function openProjectDb(projectRoot: string): Database.Database {
  const path = join(projectRoot, ".buffy", "state.db");
  ensureDir(path);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return db;
}
