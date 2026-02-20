// Shim: maps bun:sqlite API to better-sqlite3 for vitest (runs in Node.js)
import BetterSqlite3 from "better-sqlite3";

export class Database extends BetterSqlite3 {
  override exec(sql: string): this {
    super.exec(sql);
    return this;
  }
}
