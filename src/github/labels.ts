import { execa } from "execa";

export const LABELS = {
  READY: "ready",
  IN_PROGRESS: "in-progress",
  NEEDS_CTO_REVIEW: "needs-cto-review",
  CTO_APPROVED: "cto-approved",
  NEEDS_HELP: "needs-help",
} as const;

export type BuffyLabel = (typeof LABELS)[keyof typeof LABELS];

const LABEL_COLORS: Record<BuffyLabel, string> = {
  [LABELS.READY]: "0E8A16",
  [LABELS.IN_PROGRESS]: "FBCA04",
  [LABELS.NEEDS_CTO_REVIEW]: "1D76DB",
  [LABELS.CTO_APPROVED]: "0E8A16",
  [LABELS.NEEDS_HELP]: "D93F0B",
};

const LABEL_DESCRIPTIONS: Record<BuffyLabel, string> = {
  [LABELS.READY]: "Issue is ready to be picked up by Buffy",
  [LABELS.IN_PROGRESS]: "A Buffy developer session is working on this",
  [LABELS.NEEDS_CTO_REVIEW]: "PR is waiting for CTO review",
  [LABELS.CTO_APPROVED]: "PR passed CTO review, awaiting human",
  [LABELS.NEEDS_HELP]: "Developer couldn't solve it, needs human attention",
};

export async function ensureLabels(
  cwd: string,
  env?: Record<string, string>
): Promise<void> {
  const execEnv = { ...process.env, ...env };

  for (const label of Object.values(LABELS)) {
    try {
      await execa(
        "gh",
        [
          "label",
          "create",
          label,
          "--color",
          LABEL_COLORS[label],
          "--description",
          LABEL_DESCRIPTIONS[label],
          "--force",
        ],
        { cwd, env: execEnv }
      );
    } catch {
      // Label may already exist with different settings, --force handles this
    }
  }
}
