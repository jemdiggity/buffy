import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { StatusView } from "./StatusView.js";
import type { StatusData } from "./StatusView.js";
import { AttachPicker } from "./AttachPicker.js";
import { ReviewView } from "./ReviewView.js";
import type { PMRole } from "../roles/pm.js";
import type { HRManager } from "../hr/index.js";
import type { TmuxManager } from "../tmux/index.js";
import type { PRManager } from "../git/index.js";
import { LABELS } from "../github/index.js";
import type { NightShiftScheduler } from "../nightshift/index.js";

type View = "status" | "attach" | "review";

export interface AppProps {
  pm: PMRole;
  hr: HRManager;
  tmux: TmuxManager;
  prs: PRManager;
  projectName: string;
  dashboardPort: number;
  nightShift?: NightShiftScheduler;
  onQuit: () => void;
}

export function App({ pm, hr, tmux, prs, projectName, dashboardPort, nightShift, onQuit }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("status");
  const [sessions, setSessions] = useState<string[]>([]);
  const [selectedPRIndex, setSelectedPRIndex] = useState(0);
  const [reviewPRNumber, setReviewPRNumber] = useState<number | null>(null);
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

      const ctoRunning = pmStatus.ctoRunning;
      const ctoStatus = ctoRunning
        ? `reviewing ${pmStatus.ctoReviewing.map((n) => `#${n}`).join(", ")}`
        : "idle";

      let approved: Array<{ number: number; title: string }> = [];
      try {
        const prList = await prs.listByLabel(LABELS.CTO_APPROVED);
        approved = prList.map((p) => ({ number: p.number, title: p.title }));
      } catch {
        // PR fetch may fail
      }
      setApprovedPRs(approved);

      const nightShiftState = nightShift ? await nightShift.getState() : undefined;

      setStatusData({
        projectName,
        dashboardUrl: `http://localhost:${dashboardPort}`,
        pmStatus,
        ctoRunning,
        ctoStatus,
        budget,
        developers: devSessions,
        approvedPRs: approved,
        selectedPRIndex,
        nightShift: nightShiftState ? {
          active: nightShiftState.active,
          windowOpen: nightShiftState.windowOpen,
          weeklyUsagePercent: nightShiftState.weeklyUsagePercent,
          headroomPercent: nightShiftState.headroomPercent,
          throttled: nightShiftState.throttled,
          reason: nightShiftState.reason,
          nextWindowStart: nightShiftState.nextWindowStart,
          usageSource: nightShiftState.usageSource,
          fiveHourUtilization: nightShiftState.fiveHourUtilization,
        } : undefined,
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

  const handleAttach = useCallback((session: string) => {
    setView("status");
    // Open tmux session in a new terminal tab
    import("execa").then(({ execa }) => {
      if (process.platform === "darwin") {
        const script = `tell application "Terminal" to do script "tmux attach-session -t ${session}"`;
        execa("osascript", ["-e", script]).catch(() => {
          // Fallback: try iTerm2
          const iterm = `tell application "iTerm2"
            tell current window
              create tab with default profile
              tell current session
                write text "tmux attach-session -t ${session}"
              end tell
            end tell
          end tell`;
          execa("osascript", ["-e", iterm]).catch(() => {});
        });
      } else {
        // Linux: try common terminal emulators
        execa("x-terminal-emulator", ["-e", "tmux", "attach-session", "-t", session])
          .catch(() => execa("gnome-terminal", ["--", "tmux", "attach-session", "-t", session]))
          .catch(() => execa("xterm", ["-e", "tmux", "attach-session", "-t", session]))
          .catch(() => {});
      }
    });
  }, []);

  useInput((input, key) => {
    if (view === "status") {
      if (input === "q") {
        handleQuit();
      } else if (input === "a") {
        tmux.listBuffySessions(projectName).then((s) => {
          setSessions(s);
          setView("attach");
        });
      } else if (input === "r" && approvedPRs[selectedPRIndex]) {
        setReviewPRNumber(approvedPRs[selectedPRIndex]!.number);
        setView("review");
      } else if (input === "d") {
        import("execa").then(({ execa }) => {
          execa("open", [`http://localhost:${dashboardPort}`]).catch(() => {});
        });
      } else if (key.upArrow) {
        setSelectedPRIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedPRIndex((i) => Math.min(approvedPRs.length - 1, i + 1));
      } else if (input === "g" && approvedPRs[selectedPRIndex]) {
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
        onSelect={handleAttach}
        onCancel={() => setView("status")}
      />
    );
  }

  if (view === "review" && reviewPRNumber != null) {
    return (
      <ReviewView
        prNumber={reviewPRNumber}
        prs={prs}
        onBack={() => {
          setReviewPRNumber(null);
          setView("status");
        }}
        onMerged={() => {
          setReviewPRNumber(null);
          setView("status");
        }}
      />
    );
  }

  return <StatusView data={statusData} />;
}
