/**
 * events.event_group_id 旧所属を event_group_events へ移行し、legacy 列をクリアする。
 *
 * Usage:
 *   node scripts/repair-event-group-legacy.mjs [--remote] [--dry-run]
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

const legacyCount = singleCount(
  runD1(
    `SELECT COUNT(*) AS c FROM events
     WHERE event_group_id IS NOT NULL AND trim(event_group_id) <> ''`,
    remote,
  ),
);
const dupSlugCount = singleCount(
  runD1(
    `SELECT COUNT(*) AS c FROM event_groups g1
     WHERE EXISTS (
       SELECT 1 FROM event_groups g2
       WHERE g2.slug = g1.slug AND g2.id <> g1.id
     )`,
    remote,
  ),
);

console.log(`[${envLabel}] legacy events.event_group_id rows: ${legacyCount}`);
console.log(`[${envLabel}] duplicate event_groups.slug rows: ${dupSlugCount}`);

if (legacyCount === 0 && dupSlugCount === 0) {
  console.log("OK: nothing to repair.");
  process.exit(0);
}

if (dryRun) {
  console.log("dry-run: no changes applied.");
  process.exit(0);
}

if (legacyCount > 0) {
  runD1(
    `INSERT OR IGNORE INTO event_group_events (
      event_group_id, event_id, relation_type, sort_order, created_at, updated_at
    )
    SELECT event_group_id, id, 'member', 0, unixepoch(), unixepoch()
    FROM events
    WHERE event_group_id IS NOT NULL AND trim(event_group_id) <> ''`,
    remote,
  );
  runD1(
    `UPDATE events SET event_group_id = NULL
     WHERE event_group_id IS NOT NULL`,
    remote,
  );
}

if (dupSlugCount > 0) {
  runD1(
    `UPDATE event_groups
     SET slug = slug || '-' || substr(id, -6)
     WHERE id IN (
       SELECT id FROM event_groups g1
       WHERE EXISTS (
         SELECT 1 FROM event_groups g2
         WHERE g2.slug = g1.slug AND g2.id <> g1.id
       )
     )`,
    remote,
  );
}

console.log("Repair complete.");
process.exit(0);
