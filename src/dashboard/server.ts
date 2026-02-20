import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { PMRole } from "../roles/pm.js";
import type { HRManager } from "../hr/index.js";
import type { TmuxManager } from "../tmux/index.js";
import type { NightShiftScheduler } from "../nightshift/index.js";

// Embed static files at build time so they work in compiled binaries
import indexHtml from "./public/index.html" with { type: "text" };
import terminalHtml from "./public/terminal.html" with { type: "text" };
import styleCss from "./public/style.css" with { type: "text" };
import appJs from "./public/app.js" with { type: "text" };

export interface DashboardOptions {
  port: number;
  pm: PMRole;
  hr: HRManager;
  tmux: TmuxManager;
  projectName: string;
  nightShift?: NightShiftScheduler;
}

export function startDashboard(options: DashboardOptions): { close: () => void } {
  const { port, pm, hr, tmux, projectName, nightShift } = options;
  const app = new Hono();

  // API: status
  app.get("/api/status", async (c) => {
    const pmStatus = pm.getStatus();
    const budget = hr.getBudgetSnapshot();
    const developers = hr.getActiveSessions(projectName)
      .filter((s) => s.role === "developer")
      .map((s) => ({
        issueNumber: s.issue_number ?? 0,
        sessionName: s.tmux_session,
        startedAt: s.started_at,
      }));

    let nightShiftState;
    if (nightShift) {
      try {
        nightShiftState = await nightShift.getState();
      } catch {
        // Non-fatal
      }
    }

    return c.json({
      projectName,
      pm: pmStatus,
      budget,
      developers,
      nightShift: nightShiftState ?? null,
    });
  });

  // API: sessions
  app.get("/api/sessions", async (c) => {
    try {
      const sessions = await tmux.listBuffySessions(projectName);
      return c.json({ sessions });
    } catch {
      return c.json({ sessions: [] });
    }
  });

  // Static files (embedded at build time)
  const staticFiles: Record<string, { content: string; contentType: string }> = {
    "/": { content: indexHtml, contentType: "text/html" },
    "/terminal": { content: terminalHtml, contentType: "text/html" },
    "/style.css": { content: styleCss, contentType: "text/css" },
    "/app.js": { content: appJs, contentType: "application/javascript" },
  };

  for (const [path, { content, contentType }] of Object.entries(staticFiles)) {
    app.get(path, (c) => c.body(content, 200, { "Content-Type": contentType }));
  }

  const server = serve({ fetch: app.fetch, port });

  return {
    close: () => {
      server.close();
    },
  };
}
