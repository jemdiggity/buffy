import { parse as parseTOML } from "smol-toml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProjectConfig, GlobalConfig, BuffyConfig } from "./schema.js";
import { DEFAULT_PROJECT_CONFIG, DEFAULT_GLOBAL_CONFIG } from "./defaults.js";

function deepMerge<T extends Record<string, any>>(defaults: T, overrides: Record<string, any>): T {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val) && key in defaults) {
      result[key as keyof T] = deepMerge(
        defaults[key as keyof T] as Record<string, any>,
        val
      ) as T[keyof T];
    } else {
      result[key as keyof T] = val as T[keyof T];
    }
  }
  return result;
}

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, "buffy.toml");
  if (!existsSync(configPath)) {
    return { ...DEFAULT_PROJECT_CONFIG };
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseTOML(raw) as Record<string, any>;
  return deepMerge(DEFAULT_PROJECT_CONFIG, parsed);
}

export function loadGlobalConfig(): GlobalConfig {
  const configPath = join(homedir(), ".config", "buffy", "config.toml");
  if (!existsSync(configPath)) {
    return { ...DEFAULT_GLOBAL_CONFIG };
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseTOML(raw) as Record<string, any>;
  return deepMerge(DEFAULT_GLOBAL_CONFIG, parsed);
}

export function loadConfig(projectRoot: string): BuffyConfig {
  return {
    project: loadProjectConfig(projectRoot),
    global: loadGlobalConfig(),
  };
}

export function generateDefaultToml(repo: string): string {
  return `[project]
repo = "${repo}"
default_branch = "main"
# gh_token_env = "GH_TOKEN"

[pm]
poll_interval_seconds = 300
issue_filter = "is:open is:issue label:ready"
max_concurrent_developers = 3

[cto]
poll_interval_seconds = 120
review_label = "needs-cto-review"
approved_label = "cto-approved"
max_revisions = 2

[hr]
max_concurrent_sessions = 5
estimated_cost_per_minute = 0.15

[backpressure]
max_prs_awaiting_cto = 5
max_prs_awaiting_human = 3

[dashboard]
port = 3000

[worktrees]
directory = "../.buffy-worktrees"
cleanup_stale_hours = 24

[night_shift]
enabled = false
start_hour = 1
end_hour = 6
safety_margin_percent = 15
`;
}
