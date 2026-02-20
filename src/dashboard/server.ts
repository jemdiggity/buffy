import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PMRole } from "../roles/pm.js";
import type { HRManager } from "../hr/index.js";
import type { TmuxManager } from "../tmux/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  port: number;
  pm: PMRole;
  hr: HRManager;
  tmux: TmuxManager;
  projectName: string;
}

export function startDashboard(options: DashboardOptions): { close: () => void } {
  const { port, pm, hr, tmux, projectName } = options;
  const app = new Hono();
  const publicDir = join(__dirname, "public");

  // API: status
  app.get("/api/status", (c) => {
    const pmStatus = pm.getStatus();
    const budget = hr.getBudgetSnapshot();
    const developers = hr.getActiveSessions(projectName)
      .filter((s) => s.role === "developer")
      .map((s) => ({
        issueNumber: s.issue_number ?? 0,
        sessionName: s.tmux_session,
        startedAt: s.started_at,
      }));

    return c.json({
      projectName,
      pm: pmStatus,
      budget,
      developers,
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

  // Static files
  const serveFile = (filename: string, contentType: string) => {
    return (c: any) => {
      try {
        const content = readFileSync(join(publicDir, filename), "utf-8");
        return c.body(content, 200, { "Content-Type": contentType });
      } catch {
        return c.text("Not found", 404);
      }
    };
  };

  app.get("/", serveFile("index.html", "text/html"));
  app.get("/terminal", serveFile("terminal.html", "text/html"));
  app.get("/style.css", serveFile("style.css", "text/css"));
  app.get("/app.js", serveFile("app.js", "application/javascript"));

  const server = serve({ fetch: app.fetch, port });

  return {
    close: () => {
      server.close();
    },
  };
}
