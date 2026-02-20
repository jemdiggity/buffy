import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOAuthToken, clearCachedToken } from "./credentials.js";

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// Mock fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock os
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
  platform: vi.fn(() => "darwin"),
  userInfo: () => ({ username: "testuser" }),
}));

import { execa } from "execa";
import { readFileSync } from "node:fs";
import { platform } from "node:os";

const mockedExeca = vi.mocked(execa);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedPlatform = vi.mocked(platform);

describe("getOAuthToken", () => {
  beforeEach(() => {
    clearCachedToken();
    vi.resetAllMocks();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    mockedPlatform.mockReturnValue("darwin");
  });

  afterEach(() => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it("returns token from env var first", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "env-token-123";
    const token = await getOAuthToken();
    expect(token).toBe("env-token-123");
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("reads from macOS Keychain on darwin", async () => {
    mockedPlatform.mockReturnValue("darwin");
    mockedExeca.mockResolvedValue({
      stdout: JSON.stringify({ claudeAiOauth: { accessToken: "keychain-token" } }),
    } as any);

    const token = await getOAuthToken();
    expect(token).toBe("keychain-token");
    expect(mockedExeca).toHaveBeenCalledWith("security", [
      "find-generic-password",
      "-s", "Claude Code-credentials",
      "-a", "testuser",
      "-w",
    ]);
  });

  it("falls back to credentials file when keychain fails", async () => {
    mockedPlatform.mockReturnValue("darwin");
    mockedExeca.mockRejectedValue(new Error("keychain error"));
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "file-token" } })
    );

    const token = await getOAuthToken();
    expect(token).toBe("file-token");
  });

  it("reads from credentials file on Linux", async () => {
    mockedPlatform.mockReturnValue("linux");
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "linux-file-token" } })
    );

    const token = await getOAuthToken();
    expect(token).toBe("linux-file-token");
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("throws when no token source is available", async () => {
    mockedPlatform.mockReturnValue("linux");
    mockedReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });

    await expect(getOAuthToken()).rejects.toThrow("Could not find Claude Code OAuth token");
  });

  it("caches token across calls", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "cached-token";
    await getOAuthToken();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Should still return cached value
    const token = await getOAuthToken();
    expect(token).toBe("cached-token");
  });

  it("clearCachedToken forces re-read", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "first-token";
    await getOAuthToken();

    clearCachedToken();
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "second-token";
    const token = await getOAuthToken();
    expect(token).toBe("second-token");
  });
});
