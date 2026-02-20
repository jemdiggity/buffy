import { describe, it, expect } from "vitest";
import { IssueManager } from "./issues.js";
import type { GitHubIssue } from "./issues.js";

describe("IssueManager", () => {
  describe("prioritize", () => {
    const manager = new IssueManager("/tmp");

    const makeIssue = (overrides: Partial<GitHubIssue>): GitHubIssue => ({
      number: 1,
      title: "test",
      labels: ["ready"],
      state: "open",
      url: "https://github.com/test/test/issues/1",
      assignees: [],
      createdAt: "2024-01-01T00:00:00Z",
      ...overrides,
    });

    it("puts milestone issues first", () => {
      const issues = [
        makeIssue({ number: 1 }),
        makeIssue({ number: 2, milestone: "v1.0" }),
        makeIssue({ number: 3 }),
      ];
      const sorted = manager.prioritize(issues);
      expect(sorted[0]!.number).toBe(2);
    });

    it("sorts by creation date within same priority", () => {
      const issues = [
        makeIssue({ number: 1, createdAt: "2024-03-01T00:00:00Z" }),
        makeIssue({ number: 2, createdAt: "2024-01-01T00:00:00Z" }),
        makeIssue({ number: 3, createdAt: "2024-02-01T00:00:00Z" }),
      ];
      const sorted = manager.prioritize(issues);
      expect(sorted.map((i) => i.number)).toEqual([2, 3, 1]);
    });

    it("does not mutate original array", () => {
      const issues = [
        makeIssue({ number: 1, createdAt: "2024-03-01T00:00:00Z" }),
        makeIssue({ number: 2, createdAt: "2024-01-01T00:00:00Z" }),
      ];
      manager.prioritize(issues);
      expect(issues[0]!.number).toBe(1);
    });
  });
});
