export interface ProjectSection {
  repo: string;
  default_branch: string;
  gh_token_env: string;
}

export interface PMSection {
  poll_interval_seconds: number;
  issue_filter: string;
  max_concurrent_developers: number;
}

export interface CTOSection {
  poll_interval_seconds: number;
  review_label: string;
  approved_label: string;
  max_revisions: number;
  gh_token_env?: string;
}

export interface HRSection {
  max_concurrent_sessions: number;
  estimated_cost_per_minute: number;
}

export interface BackpressureSection {
  max_prs_awaiting_cto: number;
  max_prs_awaiting_human: number;
}

export interface DashboardSection {
  port: number;
}

export interface NightShiftSection {
  enabled: boolean;
  start_hour: number;
  end_hour: number;
  safety_margin_percent: number;
  weekly_session_minutes_limit: number;
  max_concurrent_developers: number;
}

export interface ProjectConfig {
  project: ProjectSection;
  pm: PMSection;
  cto: CTOSection;
  hr: HRSection;
  backpressure: BackpressureSection;
  dashboard: DashboardSection;
  night_shift: NightShiftSection;
}

export interface GlobalHRSection {
  max_total_sessions: number;
  max_cost_per_day_usd: number;
  throttle_at_percent: number;
}

export interface GlobalConfig {
  hr: GlobalHRSection;
}

export interface BuffyConfig {
  project: ProjectConfig;
  global: GlobalConfig;
}
