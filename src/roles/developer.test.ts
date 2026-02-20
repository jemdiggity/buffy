import { describe, it, expect } from "vitest";
import { DeveloperRole } from "./developer.js";

describe("DeveloperRole", () => {
  const dev = new DeveloperRole();

  describe("buildPrompt", () => {
    it("replaces template variables", () => {
      const prompt = dev.buildPrompt({
        project: "myapp",
        issueNumber: 42,
        repo: "owner/myapp",
        worktreePath: "/tmp/worktree",
        branch: "buffy/issue-42",
      });
      expect(prompt).toContain("owner/myapp");
      expect(prompt).toContain("#42");
      expect(prompt).toContain("gh issue view 42");
      expect(prompt).toContain("buffy/issue-42");
    });

    it("includes PR title prefix when provided", () => {
      const prompt = dev.buildPrompt({
        project: "myapp",
        issueNumber: 42,
        repo: "owner/myapp",
        worktreePath: "/tmp/worktree",
        branch: "buffy/issue-42",
        prTitlePrefix: "[buffy] ",
      });
      expect(prompt).toContain("[buffy] fix:");
    });
  });

  describe("sessionName", () => {
    it("generates correct session name", () => {
      expect(dev.sessionName("myapp", 42)).toBe("buffy-myapp-dev-42");
    });
  });
});
