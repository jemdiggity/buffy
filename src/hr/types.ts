export interface SessionRecord {
  id?: number;
  project: string;
  role: string; // "pm" | "cto" | "developer"
  issue_number?: number;
  tmux_session: string;
  worktree_path?: string;
  worktree_branch?: string;
  started_at: string; // ISO 8601
  ended_at?: string; // ISO 8601
  estimated_cost_usd?: number;
}

export interface CapacityCheck {
  canSpawn: boolean;
  reason?: string;
  activeProjectSessions: number;
  activeTotalSessions: number;
  estimatedDailyCostUsd: number;
}

export interface BudgetSnapshot {
  activeProjectSessions: number;
  activeTotalSessions: number;
  maxProjectSessions: number;
  maxTotalSessions: number;
  estimatedDailyCostUsd: number;
  maxDailyCostUsd: number;
  burnRatePerMinute: number;
  estimatedMonthlyCostUsd?: number;
  burnRateSource: "api" | "estimated";
  planPriceUsd: number;
}

export interface UsageSnapshotRecord {
  id?: number;
  timestamp: string;
  five_hour_utilization: number;
  seven_day_utilization: number;
  source: string;
}
