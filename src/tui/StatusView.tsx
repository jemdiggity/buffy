import React from "react";
import { Box, Text } from "ink";
import { Panel } from "./components/Panel.js";
import { RoleStatus } from "./components/RoleStatus.js";
import { KeyHints } from "./components/KeyHints.js";
import type { PMStatus } from "../roles/pm.js";
import type { BudgetSnapshot } from "../hr/index.js";

export interface StatusData {
  projectName: string;
  dashboardUrl: string;
  pmStatus: PMStatus | null;
  ctoRunning: boolean;
  ctoStatus: string;
  budget: BudgetSnapshot | null;
  developers: Array<{ issueNumber: number; sessionName: string; status: string }>;
  approvedPRs: Array<{ number: number; title: string }>;
  selectedPRIndex: number;
}

interface StatusViewProps {
  data: StatusData;
}

export function StatusView({ data }: StatusViewProps) {
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="magenta" paddingX={1} justifyContent="space-between">
        <Text bold color="magenta">Buffy v0.1.0 — {data.projectName}</Text>
        <Text color="gray">Dashboard: {data.dashboardUrl}</Text>
      </Box>

      {/* Main content: two columns */}
      <Box gap={2} marginTop={1}>
        {/* Left column: Roles + Budget */}
        <Box flexDirection="column" width="50%">
          <Panel title="Roles">
            <RoleStatus
              name="PM"
              status={data.pmStatus?.state ?? "stopped"}
              active={data.pmStatus?.state !== "idle" && data.pmStatus != null}
            />
            <RoleStatus
              name="CTO"
              status={data.ctoStatus}
              active={data.ctoRunning}
            />
            {data.developers.map((dev) => (
              <RoleStatus
                key={dev.issueNumber}
                name={`Dev #${dev.issueNumber}`}
                status={dev.status}
                active={true}
              />
            ))}
          </Panel>

          {data.budget && (
            <Panel title="Budget">
              <Text>
                Sessions: {data.budget.activeProjectSessions}/{data.budget.maxProjectSessions}
              </Text>
              <Text>
                Est. cost today: ${data.budget.estimatedDailyCostUsd.toFixed(2)}/${data.budget.maxDailyCostUsd.toFixed(2)}
              </Text>
              <Text>
                Burn rate: ${data.budget.burnRatePerMinute.toFixed(2)}/min
              </Text>
            </Panel>
          )}
        </Box>

        {/* Right column: Pipeline + PR list */}
        <Box flexDirection="column" width="50%">
          <Panel title="Pipeline">
            <Text>PRs awaiting CTO:    {data.pmStatus?.prsAwaitingCTO ?? 0}</Text>
            <Text>PRs awaiting human:  {data.pmStatus?.prsAwaitingHuman ?? 0}</Text>
          </Panel>

          <Panel title="Ready for Review">
            {data.approvedPRs.length === 0 ? (
              <Text color="gray">No PRs ready</Text>
            ) : (
              data.approvedPRs.map((pr, i) => (
                <Text key={pr.number}>
                  <Text color={i === data.selectedPRIndex ? "cyan" : undefined}>
                    {i === data.selectedPRIndex ? " \u25b8 " : "   "}
                  </Text>
                  <Text>PR #{pr.number}  {pr.title}</Text>
                </Text>
              ))
            )}
          </Panel>
        </Box>
      </Box>

      {/* Key hints */}
      <KeyHints
        hints={[
          { key: "r", action: "review PR" },
          { key: "g", action: "open in GitHub" },
          { key: "\u2191\u2193", action: "navigate" },
          { key: "a", action: "attach" },
          { key: "d", action: "dashboard" },
          { key: "q", action: "quit" },
        ]}
      />
    </Box>
  );
}
