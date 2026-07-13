#!/usr/bin/env node
import fs from "node:fs";

const path = "workers/youtube-sync/index.ts";
let source = fs.readFileSync(path, "utf8");

function replaceCount(before, after, expectedCount) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`expected ${expectedCount} occurrences, got ${count}: ${before.slice(0, 100)}`);
  }
  source = source.split(before).join(after);
}

replaceCount(
  `AND (e.start_time IS NULL OR e.start_time <= ?1)`,
  `AND e.start_time IS NOT NULL\n             AND e.start_time <= ?1`,
  1,
);
replaceCount(
  `AND (active_e.start_time IS NULL OR active_e.start_time <= ?1)`,
  `AND active_e.start_time IS NOT NULL\n                AND active_e.start_time <= ?1`,
  1,
);
replaceCount(
  `function successInterval(row: SyncRow, now: number): number {\n  if (row.active_event === 1) return HOUR;\n  const recentBoundary = now - 7 * DAY;\n  const nearBoundary = now - DAY;\n  if (row.created_at >= nearBoundary) return HOUR;\n  if ((row.scheduled_time ?? 0) >= nearBoundary) return HOUR;\n  if ((row.scheduled_time ?? 0) >= recentBoundary) return 6 * HOUR;\n  return DAY;\n}`,
  `function successInterval(row: SyncRow, now: number): number {\n  if (row.active_event === 1) return HOUR;\n\n  const referenceTime = Math.max(\n    row.created_at,\n    row.scheduled_time ?? 0,\n  );\n  const age = Math.max(0, now - referenceTime);\n  if (age <= DAY) return HOUR;\n  if (age <= 7 * DAY) return 6 * HOUR;\n  if (age <= 30 * DAY) return DAY;\n  if (age <= 180 * DAY) return 3 * DAY;\n  return 30 * DAY;\n}`,
  1,
);

fs.writeFileSync(path, source);
fs.rmSync("scripts/agent-tune-youtube-free-tier.mjs");
fs.rmSync(".github/workflows/agent-tune-youtube-free-tier.yml");
console.log("YouTube free-tier scheduling tuned");
