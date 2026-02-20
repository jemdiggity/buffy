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
        repoRoot: "/tmp/repo",
      });
      expect(prompt).toContain("owner/myapp");
      expect(prompt).toContain("#42");
      expect(prompt).toContain("gh issue view 42");
    });

    it("includes PR title prefix when provided", () => {
      const prompt = dev.buildPrompt({
        project: "myapp",
        issueNumber: 42,
        repo: "owner/myapp",
        repoRoot: "/tmp/repo",
        prTitlePrefix: "[buffy] ",
      });
      expect(prompt).toContain("[buffy] fix:");
    });

    it("does not contain branch template variable", () => {
      const prompt = dev.buildPrompt({
        project: "myapp",
        issueNumber: 42,
        repo: "owner/myapp",
        repoRoot: "/tmp/repo",
      });
      expect(prompt).not.toContain("{{BRANCH}}");
    });

    it("tells developer to create a feature branch", () => {
      const prompt = dev.buildPrompt({
        project: "myapp",
        issueNumber: 42,
        repo: "owner/myapp",
        repoRoot: "/tmp/repo",
      });
      expect(prompt).toContain("Create a feature branch");
    });
  });

  describe("sessionName", () => {
    it("generates correct session name", () => {
      expect(dev.sessionName("myapp", 42)).toBe("buffy-myapp-dev-42");
    });
  });
});
