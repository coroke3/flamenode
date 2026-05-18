/**
 * X ID merge の影響範囲 dry-run スクリプト。
 *
 * Usage:
 *   node scripts/merge-dry-run.mjs --from <oldXId> --to <newXId> [--remote]
 *
 * - --remote を付けると本番 D1 を参照 (wrangler d1 execute --remote)
 * - 付けないとローカル .wrangler/state の D1 を参照
 * - 何も書き換えない (SELECT のみ)
 * - 出力: 各テーブルの影響件数 + UNIQUE 衝突予想件数
 *
 * exit 0 = 成功 (実行可)、exit 1 = UNIQUE 衝突あり (要手動 cleanup)、exit 2 = エラー
 */

import { execSync } from "node:child_process";

function parseArgs() {
  const args = process.argv.slice(2);
  let from = null;
  let to = null;
  let remote = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from") from = args[++i];
    else if (args[i] === "--to") to = args[++i];
    else if (args[i] === "--remote") remote = true;
  }
  if (!from || !to) {
    console.error("Usage: node scripts/merge-dry-run.mjs --from <oldXId> --to <newXId> [--remote]");
    process.exit(2);
  }
  return { from, to, remote };
}

function normalizeXId(x) {
  return String(x ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function runD1(sql, remote) {
  const flag = remote ? "--remote" : "--local";
  // wrangler d1 execute は JSON 出力対応
  const out = execSync(
    `wrangler d1 execute flamenode_db ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out);
}

function singleCount(result) {
  // wrangler d1 execute --json 出力例: [{"results":[{"c":N}], "success":true, ...}]
  try {
    const rows = Array.isArray(result) ? result[0]?.results : result?.results;
    return Number(rows?.[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

const { from, to, remote } = parseArgs();
const fromXId = normalizeXId(from);
const toXId = normalizeXId(to);

if (!fromXId || !toXId) {
  console.error("Invalid X ID after normalization");
  process.exit(2);
}
if (fromXId === toXId) {
  console.error("from と to が同じ X ID です");
  process.exit(2);
}

console.log(`\nMerge dry-run: @${fromXId} → @${toXId} (${remote ? "REMOTE D1" : "LOCAL D1"})`);
console.log("=".repeat(60));

const targets = [
  { name: "videos.creator_id", sql: `SELECT COUNT(*) AS c FROM videos WHERE creator_id = '${fromXId}'` },
  { name: "video_chapters.x_user_id", sql: `SELECT COUNT(*) AS c FROM video_chapters WHERE x_user_id = '${fromXId}'` },
  { name: "video_members.x_user_id", sql: `SELECT COUNT(*) AS c FROM video_members WHERE x_user_id = '${fromXId}'` },
  { name: "slots.x_user_id", sql: `SELECT COUNT(*) AS c FROM slots WHERE x_user_id = '${fromXId}'` },
  { name: "video_interactions.x_user_id", sql: `SELECT COUNT(*) AS c FROM video_interactions WHERE x_user_id = '${fromXId}'` },
  { name: "event_editors.x_user_id", sql: `SELECT COUNT(*) AS c FROM event_editors WHERE x_user_id = '${fromXId}'` },
];

let totalRows = 0;
for (const t of targets) {
  try {
    const c = singleCount(runD1(t.sql, remote));
    totalRows += c;
    console.log(`  ${t.name.padEnd(36)}: ${String(c).padStart(6)} rows`);
  } catch (e) {
    console.error(`  ${t.name}: query failed - ${e.message}`);
    process.exit(2);
  }
}

// UNIQUE 衝突予想 (video_interactions のみ問題になる)
let conflicts = 0;
try {
  const sql = `
    SELECT COUNT(*) AS c
    FROM video_interactions a
    WHERE a.x_user_id = '${fromXId}'
      AND EXISTS (
        SELECT 1 FROM video_interactions b
        WHERE b.x_user_id = '${toXId}'
          AND b.video_id = a.video_id
          AND b.interaction_type = a.interaction_type
      )
  `.replace(/\s+/g, " ").trim();
  conflicts = singleCount(runD1(sql, remote));
  console.log("");
  console.log(`  video_interactions UNIQUE 衝突予想: ${conflicts} rows`);
  if (conflicts > 0) {
    console.log("  ⚠️  事前に DELETE FROM video_interactions WHERE x_user_id='" + fromXId + "' AND (...) で重複除去が必要");
  }
} catch (e) {
  console.error(`  UNIQUE conflict check failed: ${e.message}`);
}

console.log("");
console.log(`Summary: 合計 ${totalRows} 行を ${fromXId} → ${toXId} に更新します。`);
console.log(`Phase B (mergeXIds Server Action) は未実装。本実装は docs/merge-flow-design.md 参照。`);

process.exit(conflicts > 0 ? 1 : 0);
