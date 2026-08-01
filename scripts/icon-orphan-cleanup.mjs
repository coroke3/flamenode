/**
 * R2 上の未参照アイコンオブジェクトを検出し、任意で削除する管理用スクリプト。
 * 本番デプロイや通常リクエストからは呼ばない（scripts のみ）。
 *
 * Usage:
 *   node scripts/icon-orphan-cleanup.mjs [--remote] [--bucket NAME] [--keys-file path] [--limit 50] [--include-staging] [--apply]
 *
 * - デフォルトは dry-run（削除しない）
 * - --apply 指定時のみ削除（参照確認に成功したキーのみ、--limit まで）
 * - staging（xicons/staging/）は別カテゴリ。--include-staging なしでは正式 orphan 清掃対象外
 * - Remote D1 / R2 は --remote 必須。デフォルトは local
 * - R2 一覧は wrangler r2 object list を試行。未対応 CLI では --keys-file（1行1キー）を使用
 *
 * exit 0 = 成功、exit 2 = 引数/環境エラー
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_MEDIA_URL_PREFIX = "/api/media/";
export const SAFE_ICON_KEY_REGEX = /^[a-zA-Z0-9/_.-]+$/;
export const ICON_CLEANUP_PREFIXES = ["xicons/", "video-icons/"];
export const STAGING_PREFIX = "xicons/staging/";

export const ICON_REFERENCE_CHECK_SQL = `
SELECT 1 AS referenced
WHERE EXISTS (
  SELECT 1 FROM x_users xu
  WHERE xu.icon_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM videos v
  WHERE v.creator_icon_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM events e
  WHERE e.icon_url = ?1 OR e.img_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM event_groups eg
  WHERE eg.icon_url = ?1 OR eg.img_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM static_artifacts sa
  WHERE sa.object_key = ?2
    AND sa.target_type = 'public_media'
    AND sa.deleted_at IS NULL
  LIMIT 1
)
LIMIT 1
`.trim();

const REFERENCED_KEYS_SQL = `
SELECT icon_url AS value, 'url' AS kind FROM x_users WHERE icon_url IS NOT NULL AND trim(icon_url) <> ''
UNION ALL
SELECT creator_icon_url, 'url' FROM videos WHERE creator_icon_url IS NOT NULL AND trim(creator_icon_url) <> ''
UNION ALL
SELECT icon_url, 'url' FROM events WHERE icon_url IS NOT NULL AND trim(icon_url) <> ''
UNION ALL
SELECT img_url, 'url' FROM events WHERE img_url IS NOT NULL AND trim(img_url) <> ''
UNION ALL
SELECT icon_url, 'url' FROM event_groups WHERE icon_url IS NOT NULL AND trim(icon_url) <> ''
UNION ALL
SELECT img_url, 'url' FROM event_groups WHERE img_url IS NOT NULL AND trim(img_url) <> ''
UNION ALL
SELECT object_key AS value, 'key' AS kind FROM static_artifacts
WHERE target_type = 'public_media' AND deleted_at IS NULL AND trim(object_key) <> ''
`.replace(/\s+/g, " ").trim();

export function isUnsafeMediaKey(key) {
  return !key || key.includes("..") || key.includes("\\") || /[\x00-\x1F\x7F]/.test(key);
}

export function isSafeIconKey(key) {
  return !isUnsafeMediaKey(key) && SAFE_ICON_KEY_REGEX.test(key);
}

export function classifyIconKey(key, includeStaging = false) {
  if (!isSafeIconKey(key)) return "rejected";
  if (key.startsWith(STAGING_PREFIX)) {
    return includeStaging ? "staging" : "excluded-staging";
  }
  if (key.startsWith("xicons/")) return "formal-xicons";
  if (key.startsWith("video-icons/")) return "video-icons";
  return "rejected";
}

export function extractKeyFromMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith(PUBLIC_MEDIA_URL_PREFIX)) return null;
  const key = trimmed.slice(PUBLIC_MEDIA_URL_PREFIX.length);
  return isSafeIconKey(key) ? key : null;
}

export function toMediaUrl(objectKey) {
  return `${PUBLIC_MEDIA_URL_PREFIX}${objectKey}`;
}

export function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

export function buildReferenceCheckSql(mediaUrl, objectKey) {
  const url = escapeSqlLiteral(mediaUrl);
  const key = escapeSqlLiteral(objectKey);
  return ICON_REFERENCE_CHECK_SQL.replace(/\?1/g, `'${url}'`).replace(/\?2/g, `'${key}'`);
}

export function collectReferencedKeys(rows) {
  const referenced = new Set();
  for (const row of rows) {
    if (!row?.value) continue;
    if (row.kind === "key") {
      if (isSafeIconKey(row.value)) referenced.add(row.value);
      continue;
    }
    const key = extractKeyFromMediaUrl(row.value);
    if (key) referenced.add(key);
  }
  return referenced;
}

export function computeOrphanGroups(objectEntries, referencedKeys) {
  const referenced = referencedKeys instanceof Set ? referencedKeys : new Set(referencedKeys);
  const groups = {
    "formal-xicons": [],
    staging: [],
    "video-icons": [],
  };

  for (const entry of objectEntries) {
    const key = typeof entry === "string" ? entry : entry?.key;
    if (!key) continue;
    const category = classifyIconKey(key, true);
    if (category === "rejected") continue;
    if (referenced.has(key)) continue;
    const normalized = typeof entry === "string" ? { key, size: null } : entry;
    groups[category].push(normalized);
  }

  for (const category of Object.keys(groups)) {
    groups[category].sort((a, b) => a.key.localeCompare(b.key));
  }
  return groups;
}

export function sumBytes(entries) {
  return entries.reduce((sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0), 0);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function parseKeysFile(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function parseR2ListOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const objects = Array.isArray(parsed)
      ? parsed
      : parsed?.objects ?? parsed?.result ?? parsed?.results ?? [];
    if (!Array.isArray(objects)) return [];
    return objects
      .map((item) => {
        const key = item?.key ?? item?.name ?? item?.Key;
        if (!key) return null;
        const size = item?.size ?? item?.Size;
        return {
          key: String(key),
          size: Number.isFinite(Number(size)) ? Number(size) : null,
        };
      })
      .filter(Boolean);
  } catch {
    const entries = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const match = line.match(/^\s*(\S+)\s+(\d+)/);
      if (match) {
        entries.push({ key: match[1], size: Number(match[2]) });
      }
    }
    return entries;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    remote: false,
    apply: false,
    includeStaging: false,
    bucket: null,
    keysFile: null,
    limit: 50,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") options.remote = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--include-staging") options.includeStaging = true;
    else if (arg === "--bucket") options.bucket = argv[++i] ?? null;
    else if (arg === "--keys-file") options.keysFile = argv[++i] ?? null;
    else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.bucket && !options.keysFile) {
    options.bucket = resolveDefaultBucketName();
  }
  return options;
}

function resolveDefaultBucketName() {
  if (process.env.CF_R2_BUCKET_NAME?.trim()) {
    return process.env.CF_R2_BUCKET_NAME.trim();
  }
  try {
    const wranglerPath = path.join(process.cwd(), "wrangler.toml");
    const content = fs.readFileSync(wranglerPath, "utf8");
    const match = content.match(/bucket_name\s*=\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function d1Rows(result) {
  if (Array.isArray(result)) return result[0]?.results ?? [];
  return result?.results ?? [];
}

function isKeyReferenced(mediaUrl, objectKey, remote, runD1Fn, logFn = log) {
  if (!isSafeIconKey(objectKey)) return null;
  const sql = buildReferenceCheckSql(mediaUrl, objectKey);
  try {
    const rows = d1Rows(runD1Fn(sql, remote));
    return rows[0]?.referenced === 1;
  } catch (error) {
    logFn(`reference check failed for ${objectKey}: ${error.message}`);
    return null;
  }
}

function listR2Objects(bucket, remote) {
  const remoteFlag = remote ? "--remote" : "--local";
  const commands = [
    `wrangler r2 object list ${bucket} ${remoteFlag} --json`,
    `wrangler r2 object list ${bucket} ${remoteFlag}`,
  ];

  let lastError = null;
  for (const command of commands) {
    try {
      const out = execSync(command, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { entries: parseR2ListOutput(out), source: "wrangler" };
    } catch (error) {
      lastError = error;
    }
  }

  return { entries: null, source: "wrangler", error: lastError };
}

function deleteR2Object(bucket, key, remote) {
  const remoteFlag = remote ? "--remote" : "--local";
  execSync(`wrangler r2 object delete ${bucket}/${key} ${remoteFlag}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function printGroup(label, entries, logFn = log) {
  logFn(`${label}: ${entries.length} object(s), total size ${formatBytes(sumBytes(entries))}`);
  for (const entry of entries) {
    const sizeLabel = Number.isFinite(entry.size) ? formatBytes(entry.size) : "size unknown";
    logFn(`  - ${entry.key} (${sizeLabel})`);
  }
}

export async function runIconOrphanCleanup(options, deps = {}) {
  const exec = deps.execSync ?? execSync;
  const readFile = deps.readFileSync ?? fs.readFileSync;
  const logFn = deps.log ?? log;

  const runD1Fn =
    deps.runD1 ??
    ((sql, remote) => {
      const flag = remote ? "--remote" : "--local";
      const out = exec(
        `wrangler d1 execute flamenode_db ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return JSON.parse(out);
    });

  const fetchReferenced =
    deps.fetchReferencedKeys ??
    (() => collectReferencedKeys(d1Rows(runD1Fn(REFERENCED_KEYS_SQL, options.remote))));

  let objectEntries = [];
  let objectSource = "unknown";

  if (options.keysFile) {
    const content = readFile(options.keysFile, "utf8");
    objectEntries = parseKeysFile(content).map((key) => ({ key, size: null }));
    objectSource = `keys-file:${options.keysFile}`;
  } else {
    if (!options.bucket) {
      throw new Error("bucket name is required (use --bucket, CF_R2_BUCKET_NAME, or --keys-file)");
    }
  }

  if (!options.keysFile) {
    const listed =
      deps.listR2Objects?.(options.bucket, options.remote) ??
      listR2Objects(options.bucket, options.remote);
    if (!listed.entries) {
      throw new Error(
        `R2 object listing failed (${listed.error?.message ?? "wrangler r2 object list unavailable"}). ` +
          "Provide --keys-file with one object key per line.",
      );
    }
    objectEntries = listed.entries;
    objectSource = listed.source;
  }

  const referencedKeys = fetchReferenced();
  const groups = computeOrphanGroups(objectEntries, referencedKeys);

  const formalOrphans = groups["formal-xicons"];
  const videoOrphans = groups["video-icons"];
  const stagingOrphans = groups.staging;
  const defaultTargets = [...formalOrphans, ...videoOrphans];
  const deleteTargets = options.includeStaging
    ? [...defaultTargets, ...stagingOrphans]
    : defaultTargets;

  logFn(
    `icon orphan cleanup start mode=${options.apply ? "apply" : "dry-run"} d1=${options.remote ? "remote" : "local"} r2=${options.remote ? "remote" : "local"} source=${objectSource}`,
  );
  logFn(`referenced keys loaded: ${referencedKeys.size}`);
  printGroup("formal xicons orphans", formalOrphans, logFn);
  printGroup("video-icons orphans", videoOrphans, logFn);
  printGroup(
    options.includeStaging ? "staging orphans (included)" : "staging orphans (excluded by default)",
    stagingOrphans,
    logFn,
  );

  const limitedTargets = deleteTargets.slice(0, options.limit);
  logFn(
    `delete candidates: ${deleteTargets.length} (processing up to ${options.limit}); ` +
      `total candidate size ${formatBytes(sumBytes(limitedTargets))}`,
  );

  if (!options.apply) {
    logFn("dry-run complete: no objects deleted");
    return { deleted: [], skipped: limitedTargets.length, failed: 0 };
  }

  if (!options.bucket) {
    throw new Error("--apply requires --bucket (or CF_R2_BUCKET_NAME)");
  }

  const deleted = [];
  let failed = 0;
  let skipped = 0;

  for (const entry of limitedTargets) {
    const referenced = isKeyReferenced(
      toMediaUrl(entry.key),
      entry.key,
      options.remote,
      runD1Fn,
      logFn,
    );
    if (referenced === null) {
      logFn(`skip delete (reference check failed): ${entry.key}`);
      skipped += 1;
      continue;
    }
    if (referenced) {
      logFn(`skip delete (now referenced): ${entry.key}`);
      skipped += 1;
      continue;
    }

    try {
      if (deps.deleteR2Object) {
        deps.deleteR2Object(options.bucket, entry.key, options.remote);
      } else {
        deleteR2Object(options.bucket, entry.key, options.remote);
      }
      deleted.push(entry.key);
      logFn(`deleted: ${entry.key}`);
    } catch (error) {
      failed += 1;
      logFn(`delete failed for ${entry.key}: ${error.message}`);
    }
  }

  logFn(`apply complete: deleted=${deleted.length} skipped=${skipped} failed=${failed}`);
  return { deleted, skipped, failed };
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[${timestamp()}] ${error.message}`);
    console.error(
      "Usage: node scripts/icon-orphan-cleanup.mjs [--remote] [--bucket NAME] [--keys-file path] [--limit 50] [--include-staging] [--apply]",
    );
    process.exit(2);
  }

  try {
    await runIconOrphanCleanup(options);
    process.exit(0);
  } catch (error) {
    console.error(`[${timestamp()}] ${error.message}`);
    process.exit(2);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
