import { describe, it, expect } from "vitest";
import { LABELS } from "./labels.js";

describe("labels", () => {
  it("has all required labels", () => {
    expect(LABELS.READY).toBe("ready");
    expect(LABELS.IN_PROGRESS).toBe("in-progress");
    expect(LABELS.NEEDS_CTO_REVIEW).toBe("needs-cto-review");
    expect(LABELS.CTO_APPROVED).toBe("cto-approved");
    expect(LABELS.NEEDS_HELP).toBe("needs-help");
  });

  it("has 5 labels total", () => {
    expect(Object.keys(LABELS)).toHaveLength(5);
  });
});
