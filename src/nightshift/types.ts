export interface NightShiftState {
  active: boolean;
  windowOpen: boolean;
  weeklyUsagePercent: number;
  weekElapsedPercent: number;
  headroomPercent: number;
  throttled: boolean;
  reason: string;
  nextWindowStart?: string;
  nextWindowEnd?: string;
}

export interface UsageSnapshot {
  totalSessionMinutes: number;
  weeklyLimit: number;
  usagePercent: number;
}

export interface NightShiftSpawnDecision {
  allowed: boolean;
  maxConcurrent: number;
  reason: string;
}
