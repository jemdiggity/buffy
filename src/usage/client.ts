import type { ClaudeUsageData } from "./types.js";
import { getOAuthToken, clearCachedToken } from "./credentials.js";

const API_URL = "https://api.anthropic.com/api/oauth/usage";

interface CacheEntry {
  data: ClaudeUsageData;
  fetchedAt: number;
}

export class UsageClient {
  private cacheTtlMs: number;
  private cache: CacheEntry | null = null;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
  }

  async fetchUsage(): Promise<ClaudeUsageData | null> {
    // Return cached if fresh
    if (this.cache && Date.now() - this.cache.fetchedAt < this.cacheTtlMs) {
      return this.cache.data;
    }

    try {
      const data = await this.doFetch();
      this.cache = { data, fetchedAt: Date.now() };
      return data;
    } catch {
      return null;
    }
  }

  private async doFetch(retried = false): Promise<ClaudeUsageData> {
    const token = await getOAuthToken();

    const res = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });

    if (res.status === 401 && !retried) {
      clearCachedToken();
      return this.doFetch(true);
    }

    if (!res.ok) {
      throw new Error(`Usage API returned ${res.status}`);
    }

    const body = await res.json() as Record<string, any>;
    return {
      fiveHour: {
        utilization: body.five_hour?.utilization ?? 0,
        resetsAt: body.five_hour?.resets_at ?? null,
      },
      sevenDayOpus: {
        utilization: body.seven_day?.utilization ?? 0,
        resetsAt: body.seven_day?.resets_at ?? null,
      },
      sevenDaySonnet: {
        utilization: body.seven_day_opus?.utilization ?? 0,
        resetsAt: body.seven_day_opus?.resets_at ?? null,
      },
    };
  }
}
