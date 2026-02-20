import type { ProjectConfig, GlobalConfig } from "./schema.js";

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  project: {
    repo: "",
    default_branch: "main",
    gh_token_env: "GH_TOKEN",
  },
  pm: {
    poll_interval_seconds: 300,
    issue_filter: "is:open is:issue label:ready",
    max_concurrent_developers: 3,
  },
  cto: {
    poll_interval_seconds: 120,
    review_label: "needs-cto-review",
    approved_label: "cto-approved",
    max_revisions: 2,
  },
  hr: {
    max_concurrent_sessions: 5,
    estimated_cost_per_minute: 0.15,
  },
  backpressure: {
    max_prs_awaiting_cto: 5,
    max_prs_awaiting_human: 3,
  },
  dashboard: {
    port: 3000,
  },
  night_shift: {
    enabled: false,
    start_hour: 1,
    end_hour: 6,
    safety_margin_percent: 15,
  },
};

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  hr: {
    max_total_sessions: 10,
    max_cost_per_day_usd: 50.0,
    throttle_at_percent: 80,
  },
};
