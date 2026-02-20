import type { Database } from "bun:sqlite";
import type { Message, MessageType, RoleName } from "./types.js";

const COMMS_SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_to_role ON messages(to_role, read_at);
`;

export class CommsBus {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(COMMS_SCHEMA);
  }

  send(from: RoleName, to: RoleName, type: MessageType, payload: Record<string, unknown>): number {
    const stmt = this.db.prepare(
      `INSERT INTO messages (from_role, to_role, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(from, to, type, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  poll(role: RoleName, type?: MessageType): Message[] {
    let rows: any[];
    if (type) {
      rows = this.db
        .prepare(
          "SELECT * FROM messages WHERE to_role = ? AND type = ? AND read_at IS NULL ORDER BY id ASC"
        )
        .all(role, type);
    } else {
      rows = this.db
        .prepare(
          "SELECT * FROM messages WHERE to_role = ? AND read_at IS NULL ORDER BY id ASC"
        )
        .all(role);
    }
    return rows.map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  }

  markRead(messageId: number): void {
    this.db
      .prepare("UPDATE messages SET read_at = ? WHERE id = ?")
      .run(new Date().toISOString(), messageId);
  }

  markAllRead(role: RoleName): void {
    this.db
      .prepare("UPDATE messages SET read_at = ? WHERE to_role = ? AND read_at IS NULL")
      .run(new Date().toISOString(), role);
  }

  getAll(limit?: number): Message[] {
    const query = limit
      ? "SELECT * FROM messages ORDER BY id DESC LIMIT ?"
      : "SELECT * FROM messages ORDER BY id DESC";
    const rows = limit ? this.db.prepare(query).all(limit) : this.db.prepare(query).all();
    return (rows as any[]).map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  }

  unreadCount(role: RoleName): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages WHERE to_role = ? AND read_at IS NULL")
      .get(role) as { count: number };
    return row.count;
  }
}
