import { describe, it, expect } from "vitest";
import { CTORole } from "./cto.js";
import type { PRInfo } from "../git/index.js";

describe("CTORole", () => {
  const cto = new CTORole();

  const mockPRs: PRInfo[] = [
    {
      number: 42,
      title: "Fix auth token refresh",
      state: "OPEN",
      draft: true,
      labels: ["needs-cto-review"],
      headBranch: "buffy/issue-10",
      url: "https://github.com/owner/repo/pull/42",
      author: "buffy-dev",
    },
    {
      number: 43,
      title: "Add webhook retry logic",
      state: "OPEN",
      draft: true,
      labels: ["needs-cto-review"],
      headBranch: "buffy/issue-11",
      url: "https://github.com/owner/repo/pull/43",
      author: "buffy-dev",
    },
  ];

  describe("buildPrompt", () => {
    it("includes repo name and PR details", () => {
      const prompt = cto.buildPrompt("owner/repo", mockPRs);
      expect(prompt).toContain("owner/repo");
      expect(prompt).toContain("PR #42");
      expect(prompt).toContain("Fix auth token refresh");
      expect(prompt).toContain("PR #43");
      expect(prompt).toContain("Add webhook retry logic");
    });

    it("includes branch names", () => {
      const prompt = cto.buildPrompt("owner/repo", mockPRs);
      expect(prompt).toContain("buffy/issue-10");
      expect(prompt).toContain("buffy/issue-11");
    });
  });

  describe("sessionName", () => {
    it("generates correct session name", () => {
      expect(cto.sessionName("myapp")).toBe("buffy-myapp-cto");
    });
  });
});
