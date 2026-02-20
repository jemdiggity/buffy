import { describe, it, expect } from "vitest";
import {
  pmSessionName,
  ctoSessionName,
  devSessionName,
  isBuffySession,
  parseSessionName,
} from "./naming.js";

describe("naming", () => {
  it("generates PM session name", () => {
    expect(pmSessionName("myapp")).toBe("buffy-myapp-pm");
  });

  it("generates CTO session name", () => {
    expect(ctoSessionName("myapp")).toBe("buffy-myapp-cto");
  });

  it("generates dev session name", () => {
    expect(devSessionName("myapp", 142)).toBe("buffy-myapp-dev-142");
  });

  it("identifies buffy sessions", () => {
    expect(isBuffySession("buffy-myapp-pm")).toBe(true);
    expect(isBuffySession("other-session")).toBe(false);
  });

  describe("parseSessionName", () => {
    it("parses PM session", () => {
      expect(parseSessionName("buffy-myapp-pm")).toEqual({
        project: "myapp",
        role: "pm",
      });
    });

    it("parses CTO session", () => {
      expect(parseSessionName("buffy-myapp-cto")).toEqual({
        project: "myapp",
        role: "cto",
      });
    });

    it("parses developer session", () => {
      expect(parseSessionName("buffy-myapp-dev-142")).toEqual({
        project: "myapp",
        role: "developer",
        issueNumber: 142,
      });
    });

    it("handles hyphenated project names", () => {
      expect(parseSessionName("buffy-my-cool-app-pm")).toEqual({
        project: "my-cool-app",
        role: "pm",
      });
      expect(parseSessionName("buffy-my-cool-app-dev-99")).toEqual({
        project: "my-cool-app",
        role: "developer",
        issueNumber: 99,
      });
    });

    it("returns null for non-buffy sessions", () => {
      expect(parseSessionName("other-session")).toBeNull();
    });

    it("returns null for malformed names", () => {
      expect(parseSessionName("buffy-")).toBeNull();
    });
  });
});
