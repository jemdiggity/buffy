import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectConfig, loadGlobalConfig, generateDefaultToml } from "./loader.js";
import { DEFAULT_PROJECT_CONFIG, DEFAULT_GLOBAL_CONFIG } from "./defaults.js";

describe("loadProjectConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "buffy-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no buffy.toml exists", () => {
    const config = loadProjectConfig(tmpDir);
    expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it("parses a valid buffy.toml", () => {
    writeFileSync(
      join(tmpDir, "buffy.toml"),
      `[project]\nrepo = "owner/repo"\n\n[pm]\npoll_interval_seconds = 60\n`
    );
    const config = loadProjectConfig(tmpDir);
    expect(config.project.repo).toBe("owner/repo");
    expect(config.pm.poll_interval_seconds).toBe(60);
    // Other defaults preserved
    expect(config.pm.max_concurrent_developers).toBe(3);
    expect(config.cto.max_revisions).toBe(2);
  });

  it("deep merges partial sections", () => {
    writeFileSync(
      join(tmpDir, "buffy.toml"),
      `[night_shift]\nenabled = true\n`
    );
    const config = loadProjectConfig(tmpDir);
    expect(config.night_shift.enabled).toBe(true);
    expect(config.night_shift.start_hour).toBe(1);
    expect(config.night_shift.end_hour).toBe(6);
  });
});

describe("generateDefaultToml", () => {
  it("generates valid TOML with repo name", () => {
    const toml = generateDefaultToml("myorg/myrepo");
    expect(toml).toContain('repo = "myorg/myrepo"');
    expect(toml).toContain("[pm]");
    expect(toml).toContain("[night_shift]");
  });
});
