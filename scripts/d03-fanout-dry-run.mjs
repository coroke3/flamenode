#!/usr/bin/env node
/**
 * MIG-0658 / D-03: READ-ONLY local SQLite fan-out dry-run.
 * This program never performs migration writes or opens remote D1.
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ELIGIBLE_OWNER = [
  "FROM video_interactions_auth AS a",
  "JOIN x_user_account_links AS l",
  "  ON l.auth_user_id = a.auth_user_id AND l.link_role = 'owner'",
  "JOIN x_users AS x",
  "  ON x.id = l.x_user_id AND x.approval_status = 'approved'",
].join("\n");

const CANDIDATES = [
  "WITH expanded AS (",
  "  SELECT x.id AS x_user_id, a.video_id, a.interaction_type, a.created_at",
  ELIGIBLE_OWNER,
  "), dedup AS (",
  "  SELECT x_user_id, video_id, interaction_type, MIN(created_at) AS created_at",
  "  FROM expanded GROUP BY x_user_id, video_id, interaction_type",
  ")",
].join("\n");

// All database reads below use SELECT, never mutating SQL.
const SUMMARY = CANDIDATES + "\n" + [
  "SELECT",
  "  (SELECT COUNT(*) FROM dedup) AS candidates,",
  "  (SELECT COUNT(*) FROM expanded) - (SELECT COUNT(*) FROM dedup) AS collapsedDuplicates,",
  "  (SELECT COUNT(*) FROM video_interactions_auth AS a WHERE NOT EXISTS (",
  "    SELECT 1 FROM x_user_account_links AS l JOIN x_users AS x ON x.id = l.x_user_id",
  "    WHERE l.auth_user_id = a.auth_user_id AND l.link_role = 'owner'",
  "      AND x.approval_status = 'approved'",
  "  )) AS skippedNoOwnerLink,",
  "  (SELECT COUNT(*) FROM dedup AS d JOIN video_interactions AS existing",
  "    ON existing.x_user_id = d.x_user_id AND existing.video_id = d.video_id",
  "    AND existing.interaction_type = d.interaction_type) AS collisionCount",
].join("\n");

const CONFLICTS = CANDIDATES + "\n" + [
  "SELECT d.x_user_id AS xUserId, d.video_id AS videoId,",
  "       d.interaction_type AS interactionType,",
  "       d.created_at AS candidateCreatedAt, existing.created_at AS existingCreatedAt",
  "FROM dedup AS d",
  "JOIN video_interactions AS existing",
  "  ON existing.x_user_id = d.x_user_id AND existing.video_id = d.video_id",
  "  AND existing.interaction_type = d.interaction_type",
  "ORDER BY d.video_id, d.x_user_id, d.interaction_type",
  "LIMIT 50",
].join("\n");

const LIKE_COUNT_DELTA = CANDIDATES + ",\n" + [
  "all_likes AS (",
  // D-03 counts distinct approved X identities, including in the legacy
  // X-side rows. Do not delete disapproved X rows; only exclude from counts.
  "  SELECT existing.x_user_id, existing.video_id",
  "  FROM video_interactions AS existing",
  "  JOIN x_users AS x ON x.id = existing.x_user_id",
  "  WHERE existing.interaction_type = 'like' AND x.approval_status = 'approved'",
  "  UNION",
  "  SELECT x_user_id, video_id FROM dedup WHERE interaction_type = 'like'",
  "), predicted AS (",
  "  SELECT video_id, COUNT(*) AS likes FROM all_likes GROUP BY video_id",
  ")",
  "SELECT v.id AS videoId, v.app_like_count AS current,",
  "       COALESCE(p.likes, 0) AS projected,",
  "       COALESCE(p.likes, 0) - v.app_like_count AS delta,",
  "       COUNT(*) OVER () AS totalDeltas",
  "FROM videos AS v",
  "LEFT JOIN predicted AS p ON p.video_id = v.id",
  "WHERE COALESCE(p.likes, 0) <> v.app_like_count",
  "ORDER BY ABS(COALESCE(p.likes, 0) - v.app_like_count) DESC, v.id ASC",
  "LIMIT 50",
].join("\n");

export function analyzeDatabase(db) {
  // BEGIN keeps all three SELECTs on one SQLite snapshot. Without this,
  // a local WAL writer can change collision/delta rows after SUMMARY ran.
  // ROLLBACK ends the read transaction without ever committing data.
  db.exec("BEGIN");
  try {
    const summary = db.prepare(SUMMARY).get();
    const conflicts = db.prepare(CONFLICTS).all();
    const deltaRows = db.prepare(LIKE_COUNT_DELTA).all();
    // Window COUNT counts all mismatched videos before LIMIT 50. Strip the
    // internal field so each report row keeps the established public shape.
    const likeCountDeltaTotal = Number(deltaRows[0]?.totalDeltas ?? 0);
    const likeCountDelta = deltaRows.map(({ totalDeltas, ...row }) => row);
    return {
      candidates: Number(summary.candidates),
      skippedNoOwnerLink: Number(summary.skippedNoOwnerLink),
      collapsedDuplicates: Number(summary.collapsedDuplicates),
      conflictsWithVideoInteractions: {
        count: Number(summary.collisionCount),
        first50: conflicts,
        truncated: Number(summary.collisionCount) > conflicts.length,
      },
      likeCountDelta,
      likeCountDeltaTotal,
      likeCountDeltaTruncated: likeCountDeltaTotal > likeCountDelta.length,
      maxDeltaVideo: likeCountDelta[0] ?? null,
    };
  } finally {
    db.exec("ROLLBACK");
  }
}

export function analyzeLocalFile(file) {
  const db = new DatabaseSync(resolve(file), { readOnly: true, open: true });
  try {
    // Defense in depth: accidental future statements must not mutate.
    db.exec("PRAGMA query_only = ON");
    return analyzeDatabase(db);
  } finally {
    db.close();
  }
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return null;
  if (args.length !== 2 || args[0] !== "--sqlite" || !args[1] ||
      args[1].startsWith("-") || /^(https?:|d1:|file:)/i.test(args[1])) {
    throw new Error("Usage: node scripts/d03-fanout-dry-run.mjs --sqlite <local-file-path>");
  }
  return args[1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = parseArgs(process.argv.slice(2));
    if (file === null) {
      console.log("Usage: node scripts/d03-fanout-dry-run.mjs --sqlite <local-file-path>");
    } else {
      console.log(JSON.stringify(analyzeLocalFile(file)));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
