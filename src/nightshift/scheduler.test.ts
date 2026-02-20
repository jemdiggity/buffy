import { describe, it, expect, vi } from "vitest";
import { NightShiftScheduler } from "./scheduler.js";
import type { NightShiftSection } from "../config/index.js";
import type { WeeklyUsageTracker } from "./usage.js";
import type { UsageSnapshot } from "./types.js";

function createConfig(overrides?: Partial<NightShiftSection>): NightShiftSection {
  return {
    enabled: true,
    start_hour: 1,
    end_hour: 6,
    safety_margin_percent: 15,
    weekly_session_minutes_limit: 600,
    max_concurrent_developers: 5,
    ...overrides,
  };
}

function createMockUsage(
  usagePercent: number,
  source: "api" | "estimated" = "estimated",
  fiveHourUtilization?: number
): WeeklyUsageTracker {
  const snapshot: UsageSnapshot = {
    totalSessionMinutes: usagePercent * 6, // 600 limit * percent / 100
    weeklyLimit: 600,
    usagePercent,
    source,
    fiveHourUtilization,
  };
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
  } as any;
}

describe("NightShiftScheduler", () => {
  describe("isInWindow", () => {
    it("returns true when current hour is within window", () => {
      const scheduler = new NightShiftScheduler(
        createConfig({ start_hour: 1, end_hour: 6 }),
        createMockUsage(0),
        () => new Date("2026-02-20T03:00:00")
      );
      expect(scheduler.isInWindow()).toBe(true);
    });

    it("returns false when current hour is outside window", () => {
      const scheduler = new NightShiftScheduler(
        createConfig({ start_hour: 1, end_hour: 6 }),
        createMockUsage(0),
        () => new Date("2026-02-20T12:00:00")
      );
      expect(scheduler.isInWindow()).toBe(false);
    });

    it("handles midnight crossing (e.g., 22:00 - 6:00)", () => {
      const config = createConfig({ start_hour: 22, end_hour: 6 });

      const at23 = new NightShiftScheduler(config, createMockUsage(0), () => new Date("2026-02-20T23:00:00"));
      expect(at23.isInWindow()).toBe(true);

      const at3 = new NightShiftScheduler(config, createMockUsage(0), () => new Date("2026-02-20T03:00:00"));
      expect(at3.isInWindow()).toBe(true);

      const at12 = new NightShiftScheduler(config, createMockUsage(0), () => new Date("2026-02-20T12:00:00"));
      expect(at12.isInWindow()).toBe(false);
    });

    it("returns false when disabled", () => {
      const scheduler = new NightShiftScheduler(
        createConfig({ enabled: false }),
        createMockUsage(0),
        () => new Date("2026-02-20T03:00:00")
      );
      expect(scheduler.isInWindow()).toBe(false);
    });
  });

  describe("shouldSpawn", () => {
    it("allows spawning when in window with headroom", async () => {
      // Wednesday 3am = ~(3*24 + 3) = 75 hours into week = ~44.6% elapsed
      // Usage at 20% < 44.6% -> has headroom
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(20),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(true);
      expect(decision.maxConcurrent).toBe(5);
    });

    it("blocks when usage exceeds elapsed time", async () => {
      // Sunday 3am = ~3 hours into week = ~1.8% elapsed
      // Usage at 50% > 1.8% -> no headroom
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(50),
        () => new Date("2026-02-22T03:00:00") // Sunday
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(false);
    });

    it("blocks when approaching safety margin", async () => {
      // safety_margin_percent = 15, so threshold = 85%
      const scheduler = new NightShiftScheduler(
        createConfig({ safety_margin_percent: 15 }),
        createMockUsage(86),
        () => new Date("2026-02-21T03:00:00") // Saturday, late in week
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("safety threshold");
    });

    it("blocks when disabled", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig({ enabled: false }),
        createMockUsage(0),
        () => new Date("2026-02-20T03:00:00")
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("disabled");
    });

    it("blocks when outside window", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(0),
        () => new Date("2026-02-20T12:00:00")
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("Outside");
    });

    it("blocks when 5-hour utilization exceeds threshold", async () => {
      // 5-hour at 85% > 80% threshold -> block even with weekly headroom
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(20, "api", 85),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("5-hour utilization");
      expect(decision.reason).toContain("85.0%");
    });

    it("allows when 5-hour utilization is below threshold", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(20, "api", 50),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(true);
    });

    it("ignores 5-hour check when not available (estimated source)", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(20, "estimated"),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const decision = await scheduler.shouldSpawn();
      expect(decision.allowed).toBe(true);
    });
  });

  describe("getState", () => {
    it("returns full state with estimated source", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(20),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const state = await scheduler.getState();
      expect(state.windowOpen).toBe(true);
      expect(state.weeklyUsagePercent).toBe(20);
      expect(state.headroomPercent).toBeGreaterThan(0);
      expect(state.throttled).toBe(false);
      expect(state.usageSource).toBe("estimated");
      expect(state.fiveHourUtilization).toBeUndefined();
    });

    it("returns state with API source and 5-hour data", async () => {
      const scheduler = new NightShiftScheduler(
        createConfig(),
        createMockUsage(35, "api", 12),
        () => new Date("2026-02-18T03:00:00") // Wednesday
      );
      const state = await scheduler.getState();
      expect(state.usageSource).toBe("api");
      expect(state.fiveHourUtilization).toBe(12);
    });
  });
});
