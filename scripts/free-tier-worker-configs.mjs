import fs from "node:fs";
import path from "node:path";
import { WORKER_TARGETS } from "./new-worker-dry-run.mjs";

/**
 * Free-tier limits apply to the whole account: inspect both CURRENT workers
 * and the three TARGET Worker templates, even before their production cutover.
 * Missing TARGET templates must fail the audit rather than be silently skipped.
 */
export function readWorkerConfigs(repoRoot) {
  const workersRoot = path.join(repoRoot, "workers");
  const currentConfigs = fs
    .readdirSync(workersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workersRoot, entry.name, "wrangler.toml"))
    .filter((filePath) => fs.existsSync(filePath));
  const targetConfigs = WORKER_TARGETS.map((target) => path.join(repoRoot, target.config));

  return [...currentConfigs, ...targetConfigs].map((filePath) => ({
    filePath,
    text: fs.readFileSync(filePath, "utf8"),
  }));
}
