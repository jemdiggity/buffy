import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { StatusView } from "./StatusView.js";
import type { StatusData } from "./StatusView.js";
import { AttachPicker } from "./AttachPicker.js";
import type { PMRole } from "../roles/pm.js";
import type { HRManager } from "../hr/index.js";
import type { TmuxManager } from "../tmux/index.js";
import type { PRManager } from "../git/index.js";
import { LABELS } from "../github/index.js";

type View = "status" | "attach";

export interface AppProps {
  pm: PMRole;
  hr: HRManager;
  tmux: TmuxManager;
  prs: PRManager;
  projectName: string;
  dashboardPort: number;
  onQuit: () => void;
}

export function App({ pm, hr, tmux, prs, projectName, dashboardPort, onQuit }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("status");
  const [sessions, setSessions] = useState<string[]>([]);
  const [selectedPRIndex, setSelectedPRIndex] = useState(0);
  const [approvedPRs, setApprovedPRs] = useState<Array<{ number: number; title: string }>>([]);
  const [statusData, setStatusData] = useState<StatusData>({
    projectName,
    dashboardUrl: `http://localhost:${dashboardPort}`,
    pmStatus: null,
    ctoRunning: false,
    ctoStatus: "idle",
    budget: null,
    developers: [],
    approvedPRs: [],
    selectedPRIndex: 0,
  });

  // Poll for status updates
  useEffect(() => {
    const update = async () => {
      const pmStatus = pm.getStatus();
      const budget = hr.getBudgetSnapshot();
      const devSessions = hr.getActiveSessions(projectName)
        .filter((s) => s.role === "developer")
        .map((s) => ({
          issueNumber: s.issue_number ?? 0,
          sessionName: s.tmux_session,
          status: "coding",
        }));

      let approved: Array<{ number: number; title: string }> = [];
      try {
        const prList = await prs.listByLabel(LABELS.CTO_APPROVED);
        approved = prList.map((p) => ({ number: p.number, title: p.title }));
      } catch {
        // PR fetch may fail
      }
      setApprovedPRs(approved);

      setStatusData({
        projectName,
        dashboardUrl: `http://localhost:${dashboardPort}`,
        pmStatus,
        ctoRunning: false,
        ctoStatus: "idle",
        budget,
        developers: devSessions,
        approvedPRs: approved,
        selectedPRIndex,
      });
    };

    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, [selectedPRIndex]);

  const handleQuit = useCallback(() => {
    onQuit();
    exit();
  }, [onQuit, exit]);

  useInput((input, key) => {
    if (view === "status") {
      if (input === "q") {
        handleQuit();
      } else if (input === "a") {
        tmux.listBuffySessions(projectName).then((s) => {
          setSessions(s);
          setView("attach");
        });
      } else if (key.upArrow) {
        setSelectedPRIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedPRIndex((i) => Math.min(approvedPRs.length - 1, i + 1));
      } else if (input === "g" && approvedPRs[selectedPRIndex]) {
        // Open in browser — fire and forget
        import("execa").then(({ execa }) => {
          execa("gh", ["pr", "view", String(approvedPRs[selectedPRIndex]!.number), "--web"]).catch(() => {});
        });
      }
    }
  });

  if (view === "attach") {
    return (
      <AttachPicker
        sessions={sessions}
        onSelect={(session) => {
          setView("status");
          import("execa").then(({ execa }) => {
            execa("tmux", ["attach-session", "-t", session], { stdio: "inherit" }).catch(() => {});
          });
        }}
        onCancel={() => setView("status")}
      />
    );
  }

  return <StatusView data={statusData} />;
}
