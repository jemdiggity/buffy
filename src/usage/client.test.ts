import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageClient } from "./client.js";

// Mock credentials module
vi.mock("./credentials.js", () => ({
  getOAuthToken: vi.fn().mockResolvedValue("test-token"),
  clearCachedToken: vi.fn(),
}));

import { getOAuthToken, clearCachedToken } from "./credentials.js";

const mockedGetToken = vi.mocked(getOAuthToken);
const mockedClearToken = vi.mocked(clearCachedToken);

const VALID_RESPONSE = {
  five_hour: { utilization: 12.5, resets_at: "2026-02-20T05:00:00Z" },
  seven_day: { utilization: 35.0, resets_at: "2026-02-23T00:00:00Z" },
  seven_day_opus: { utilization: 0.0, resets_at: null },
};

describe("UsageClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGetToken.mockResolvedValue("test-token");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses a successful API response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), { status: 200 })
    );

    const client = new UsageClient({ cacheTtlMs: 0 });
    const data = await client.fetchUsage();

    expect(data).toEqual({
      fiveHour: { utilization: 12.5, resetsAt: "2026-02-20T05:00:00Z" },
      sevenDayOpus: { utilization: 35.0, resetsAt: "2026-02-23T00:00:00Z" },
      sevenDaySonnet: { utilization: 0.0, resetsAt: null },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: "Bearer test-token",
          "anthropic-beta": "oauth-2025-04-20",
        },
      }
    );
  });

  it("retries once on 401 with cleared token", async () => {
    mockedGetToken
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(VALID_RESPONSE), { status: 200 }));

    const client = new UsageClient({ cacheTtlMs: 0 });
    const data = await client.fetchUsage();

    expect(mockedClearToken).toHaveBeenCalledOnce();
    expect(data).not.toBeNull();
    expect(data!.fiveHour.utilization).toBe(12.5);
  });

  it("returns null on network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const client = new UsageClient({ cacheTtlMs: 0 });
    const data = await client.fetchUsage();

    expect(data).toBeNull();
  });

  it("returns null on non-401 HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Server Error", { status: 500 }));

    const client = new UsageClient({ cacheTtlMs: 0 });
    const data = await client.fetchUsage();

    expect(data).toBeNull();
  });

  it("caches response for configured TTL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), { status: 200 })
    );

    const client = new UsageClient({ cacheTtlMs: 60_000 });

    const first = await client.fetchUsage();
    const second = await client.fetchUsage();

    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after cache TTL expires", async () => {
    vi.useFakeTimers();

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), { status: 200 })
    );

    const client = new UsageClient({ cacheTtlMs: 1000 });
    await client.fetchUsage();

    vi.advanceTimersByTime(1500);
    await client.fetchUsage();

    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("returns null when getOAuthToken throws", async () => {
    mockedGetToken.mockRejectedValue(new Error("no token"));

    const client = new UsageClient({ cacheTtlMs: 0 });
    const data = await client.fetchUsage();

    expect(data).toBeNull();
  });
});
