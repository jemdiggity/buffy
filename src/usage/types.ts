export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface ClaudeUsageData {
  fiveHour: UsageWindow;
  sevenDayOpus: UsageWindow;
  sevenDaySonnet: UsageWindow;
}
