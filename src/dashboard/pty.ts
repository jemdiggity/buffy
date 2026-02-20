import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

let ptyModule: typeof import("node-pty") | null = null;

async function loadPty() {
  if (!ptyModule) {
    ptyModule = await import("node-pty");
  }
  return ptyModule;
}

export function attachTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/terminal" });

  wss.on("connection", async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const sessionName = url.searchParams.get("session");

    if (!sessionName) {
      ws.close(4000, "Missing session parameter");
      return;
    }

    let pty;
    try {
      const nodePty = await loadPty();
      pty = nodePty.spawn("tmux", ["attach-session", "-t", sessionName], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
      });
    } catch (err) {
      ws.close(4001, `Failed to attach to session: ${err}`);
      return;
    }

    pty.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    pty.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Session ended");
      }
    });

    ws.on("message", (data: Buffer | string) => {
      const msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          pty.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — raw terminal input
      }
      pty.write(msg);
    });

    ws.on("close", () => {
      pty.kill();
    });
  });
}
