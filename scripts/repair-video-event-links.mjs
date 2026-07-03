/**
 * primary_event_id があるのに video_events に無い行を補修する。
 *
 * Usage:
 *   node scripts/repair-video-event-links.mjs [--remote] [--dry-run]
 */

import { execSync } from "node:child_process";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    remote: args.includes("--remote"),
    dryRun: args.includes("--dry-run"),
  };
}

function runD1(sql, remote) {
  const flag = remote ? "--remote" : "--local";
  const out = execSync(
    `wrangler d1 execute flamenode_db ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out);
}

function singleCount(result) {
  try {
    const rows = Array.isArray(result) ? result[0]?.results : result?.results;
    return Number(rows?.[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

const { remote, dryRun } = parseArgs();
const envLabel = remote ? "remote" : "local";

const missing = singleCount(
  runD1(
    `SELECT COUNT(*) AS c FROM videos v
     WHERE v.primary_event_id IS NOT NULL AND trim(v.primary_event_id) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM video_events ve
       WHERE ve.video_id = v.id AND ve.event_id = v.primary_event_id
     )`,
    remote,
  ),
);

console.log(`[${envLabel}] missing primary_event video_events links: ${missing}`);

if (missing === 0) {
  console.log("OK: nothing to repair.");
  process.exit(0);
}

if (dryRun) {
  console.log("dry-run: no changes applied.");
  process.exit(0);
}

runD1(
  `INSERT OR IGNORE INTO video_events (video_id, event_id)
   SELECT v.id, v.primary_event_id
   FROM videos v
   WHERE v.primary_event_id IS NOT NULL AND trim(v.primary_event_id) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM video_events ve
     WHERE ve.video_id = v.id AND ve.event_id = v.primary_event_id
   )`,
  remote,
);

const after = singleCount(
  runD1(
    `SELECT COUNT(*) AS c FROM videos v
     WHERE v.primary_event_id IS NOT NULL AND trim(v.primary_event_id) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM video_events ve
       WHERE ve.video_id = v.id AND ve.event_id = v.primary_event_id
     )`,
    remote,
  ),
);

console.log(`Repaired. Remaining missing: ${after}`);
process.exit(after === 0 ? 0 : 1);
