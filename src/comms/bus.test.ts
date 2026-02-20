import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { CommsBus } from "./bus.js";

function createTestDb(): Database {
  return new Database(":memory:");
}

describe("CommsBus", () => {
  let db: Database;
  let bus: CommsBus;

  beforeEach(() => {
    db = createTestDb();
    bus = new CommsBus(db);
  });

  afterEach(() => {
    db.close();
  });

  it("sends and polls messages", () => {
    bus.send("pm", "cto", "pr_ready", { pr_number: 42, issue_number: 10, branch: "buffy/issue-10" });
    bus.send("pm", "developer", "spawn_request", { issue_number: 11, repo: "owner/repo" });

    const ctoMessages = bus.poll("cto");
    expect(ctoMessages).toHaveLength(1);
    expect(ctoMessages[0]!.type).toBe("pr_ready");
    expect(ctoMessages[0]!.payload).toEqual({ pr_number: 42, issue_number: 10, branch: "buffy/issue-10" });

    const devMessages = bus.poll("developer");
    expect(devMessages).toHaveLength(1);
    expect(devMessages[0]!.type).toBe("spawn_request");
  });

  it("marks messages as read", () => {
    bus.send("developer", "pm", "session_ended", { tmux_session: "buffy-test-dev-1", role: "developer", success: true });

    const before = bus.poll("pm");
    expect(before).toHaveLength(1);

    bus.markRead(before[0]!.id);
    const after = bus.poll("pm");
    expect(after).toHaveLength(0);
  });

  it("filters by message type", () => {
    bus.send("pm", "cto", "pr_ready", { pr_number: 1 });
    bus.send("pm", "cto", "alert", { level: "info", message: "test" });

    const prMessages = bus.poll("cto", "pr_ready");
    expect(prMessages).toHaveLength(1);
    expect(prMessages[0]!.type).toBe("pr_ready");
  });

  it("counts unread messages", () => {
    bus.send("developer", "pm", "session_ended", { tmux_session: "s1", role: "developer", success: true });
    bus.send("developer", "pm", "session_ended", { tmux_session: "s2", role: "developer", success: true });
    bus.send("cto", "pm", "review_complete", { pr_number: 1, approved: true, summary: "lgtm" });

    expect(bus.unreadCount("pm")).toBe(3);
    expect(bus.unreadCount("cto")).toBe(0);
  });

  it("markAllRead clears inbox for a role", () => {
    bus.send("developer", "pm", "session_ended", { tmux_session: "s1", role: "developer", success: true });
    bus.send("developer", "pm", "session_ended", { tmux_session: "s2", role: "developer", success: true });

    bus.markAllRead("pm");
    expect(bus.unreadCount("pm")).toBe(0);
  });

  it("getAll returns messages in reverse chronological order", () => {
    bus.send("pm", "cto", "pr_ready", { pr_number: 1 });
    bus.send("pm", "cto", "pr_ready", { pr_number: 2 });
    bus.send("pm", "cto", "pr_ready", { pr_number: 3 });

    const all = bus.getAll(2);
    expect(all).toHaveLength(2);
    expect((all[0]!.payload as any).pr_number).toBe(3);
    expect((all[1]!.payload as any).pr_number).toBe(2);
  });
});
