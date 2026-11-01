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

/** Drops a TOML end-of-line comment while keeping `#` inside quoted strings. */
export function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function stripTomlComments(configText) {
  return configText.split("\n").map(stripTomlComment).join("\n");
}

export function parseCronExpressions(configText) {
  return [...stripTomlComments(configText).matchAll(/^\s*crons\s*=\s*\[([^\]]*)\]\s*$/gm)]
    .flatMap(([, body]) => [...body.matchAll(/["']([^"']+)["']/g)])
    .map(([, cron]) => cron);
}

export function parseQueueConsumerBlocks(configText) {
  return stripTomlComments(configText)
    .split(/(?=^\[\[)/m)
    .filter((block) => /^\[\[queues\.consumers\]\]\s*$/m.test(block));
}
