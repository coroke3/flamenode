#!/usr/bin/env node
import fs from "node:fs";

const path = "workers/youtube-sync/index.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`replacement target not found: ${before.slice(0, 80)}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`replacement target ambiguous: ${before.slice(0, 80)}`);
  }
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  `  consecutive_failures: number;\n};`,
  `  consecutive_failures: number;\n  active_event: number;\n};`,
);
replaceOnce(
  `            v.created_at,\n            COALESCE(ym.consecutive_failures, 0) AS consecutive_failures\n       FROM videos v`,
  `            v.created_at,\n            COALESCE(ym.consecutive_failures, 0) AS consecutive_failures,\n            CASE WHEN EXISTS (\n              SELECT 1\n              FROM video_events active_ve\n              INNER JOIN events active_e ON active_e.id = active_ve.event_id\n              WHERE active_ve.video_id = v.id\n                AND active_e.visibility_status = 'public'\n                AND (active_e.start_time IS NULL OR active_e.start_time <= ?1)\n                AND (active_e.end_time IS NULL OR active_e.end_time >= ?1)\n            ) THEN 1 ELSE 0 END AS active_event\n       FROM videos v`,
);
replaceOnce(
  `function successInterval(row: SyncRow, now: number): number {\n  const recentBoundary = now - 7 * DAY;`,
  `function successInterval(row: SyncRow, now: number): number {\n  if (row.active_event === 1) return HOUR;\n  const recentBoundary = now - 7 * DAY;`,
);

fs.writeFileSync(path, source);
fs.rmSync("scripts/agent-fix-active-youtube-interval.mjs");
fs.rmSync(".github/workflows/agent-fix-active-youtube-interval.yml");
console.log("active event YouTube interval applied");
