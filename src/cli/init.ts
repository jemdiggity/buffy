import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { generateDefaultToml } from "../config/index.js";
import { ensureLabels } from "../github/index.js";

export async function initProject(projectRoot: string): Promise<void> {
  // Detect repo from git remote
  let repo = "owner/repo";
  try {
    const { stdout } = await execa("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
      cwd: projectRoot,
    });
    repo = stdout.trim();
  } catch {
    console.log("Could not detect repo from gh CLI, using placeholder");
  }

  // Create buffy.toml
  const tomlPath = join(projectRoot, "buffy.toml");
  if (!existsSync(tomlPath)) {
    writeFileSync(tomlPath, generateDefaultToml(repo));
    console.log(`Created ${tomlPath}`);
  } else {
    console.log(`${tomlPath} already exists, skipping`);
  }

  // Create .buffy/ directory
  const buffyDir = join(projectRoot, ".buffy");
  if (!existsSync(buffyDir)) {
    mkdirSync(buffyDir, { recursive: true });
    console.log(`Created ${buffyDir}/`);
  }

  // Ensure GitHub labels
  try {
    await ensureLabels(projectRoot);
    console.log("GitHub labels created/updated");
  } catch (err) {
    console.log("Could not create GitHub labels (are you authenticated with gh?)");
  }

  console.log("\nBuffy initialized! Edit buffy.toml to configure, then run: buffy");
}
