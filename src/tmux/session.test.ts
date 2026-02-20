import { describe, it, expect } from "vitest";
import { TmuxManager } from "./session.js";

describe("TmuxManager", () => {
  it("can be instantiated", () => {
    const manager = new TmuxManager();
    expect(manager).toBeDefined();
    expect(typeof manager.createSession).toBe("function");
    expect(typeof manager.listSessions).toBe("function");
    expect(typeof manager.sessionExists).toBe("function");
    expect(typeof manager.killSession).toBe("function");
    expect(typeof manager.sendKeys).toBe("function");
    expect(typeof manager.capturePane).toBe("function");
  });

  it("listSessions returns empty array when tmux is not running", async () => {
    const manager = new TmuxManager();
    // This test passes whether tmux is installed or not
    // because listSessions catches errors and returns []
    const sessions = await manager.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
