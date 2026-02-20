import { Command } from "commander";

export interface CLIOptions {
  init: boolean;
  status: boolean;
  stop: boolean;
  review: boolean;
  attach?: string;
  logs?: string;
  config?: string;
  dryRun: boolean;
  clean: boolean;
}

export function parseFlags(argv: string[]): CLIOptions {
  const program = new Command();

  program
    .name("buffy")
    .description("AI Software Development Team Orchestrator")
    .version("0.1.0")
    .option("--init", "Create buffy.toml, labels, .buffy/ dir", false)
    .option("--status", "Print status once and exit", false)
    .option("--stop", "Kill all running buffy sessions", false)
    .option("--review", "List CTO-approved PRs and exit", false)
    .option("--attach <session>", "Attach directly to a session")
    .option("--logs <session>", "Tail logs without attaching")
    .option("--config <action>", "Config actions: show")
    .option("--dry-run", "Launch without spawning sessions or touching GitHub", false)
    .option("--clean", "Remove all worktrees (use with --stop)", false);

  program.parse(argv);
  const opts = program.opts();

  return {
    init: opts.init ?? false,
    status: opts.status ?? false,
    stop: opts.stop ?? false,
    review: opts.review ?? false,
    attach: opts.attach,
    logs: opts.logs,
    config: opts.config,
    dryRun: opts.dryRun ?? false,
    clean: opts.clean ?? false,
  };
}
