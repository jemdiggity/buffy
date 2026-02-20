import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, userInfo } from "node:os";
import { execa } from "execa";

let cachedToken: string | null = null;

export async function getOAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  // 1. Environment variable override
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }

  // 2. macOS Keychain
  if (platform() === "darwin") {
    try {
      const token = await readFromMacKeychain();
      if (token) {
        cachedToken = token;
        return token;
      }
    } catch {
      // Fall through to file-based lookup
    }
  }

  // 3. Credentials file (~/.claude/.credentials.json)
  try {
    const token = readFromCredentialsFile();
    if (token) {
      cachedToken = token;
      return token;
    }
  } catch {
    // Fall through
  }

  throw new Error("Could not find Claude Code OAuth token. Set CLAUDE_CODE_OAUTH_TOKEN or ensure Claude Code is authenticated.");
}

export function clearCachedToken(): void {
  cachedToken = null;
}

async function readFromMacKeychain(): Promise<string | null> {
  const username = userInfo().username;
  const { stdout } = await execa("security", [
    "find-generic-password",
    "-s", "Claude Code-credentials",
    "-a", username,
    "-w",
  ]);

  if (!stdout) return null;

  const parsed = JSON.parse(stdout);
  const accessToken = parsed?.claudeAiOauth?.accessToken;
  return accessToken ?? null;
}

function readFromCredentialsFile(): string | null {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  const content = readFileSync(credPath, "utf-8");
  const parsed = JSON.parse(content);
  const accessToken = parsed?.claudeAiOauth?.accessToken;
  return accessToken ?? null;
}
