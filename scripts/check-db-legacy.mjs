/**
 * legacy / deleted DB 利用検査 (静的ソース解析、DB 不要)。
 *
 * Usage:
 *   node scripts/check-db-legacy.mjs
 *
 * exit 0 = OK, exit 1 = 違反検出
 *
 * 検出するもの:
 *   - 削除済み `video_comments` / `videoComments` 利用
 *   - 新規コードでの `outro_comment` 書き込み (closing_comment に統一)
 *   - 新規コードでの `marker_kind` が "chapter" 以外 (MVPは chapter 固定)
 *
 * allowlist:
 *   - 旧データ normalize / この検査スクリプト自身は許容。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app", "workers"];
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);

/** ファイル全体を許可するパス (POSIX 形式で比較) */
const FULL_ALLOW = new Set([
  // 旧データ正規化 (legacy import) は outro/closing 含めて許容
  "src/lib/legacy/normalize.ts",
  // この検査スクリプト自身
  "scripts/check-db-legacy.mjs",
]);

/** 移行中テーブル定義・migration SQL は許容 */
const PREFIX_ALLOW = [
  "migrations/",
  "src/lib/db/schema.ts",
];

/** 削除予定テーブルへの新規書き込みを検出（段階的に allowlist を縮小する） */
const DB_REDUCTION_RULES = [
  {
    id: "video-stats-usage",
    label: "video_stats / videoStats usage after DB reduction",
    pattern: /\b(videoStats|video_stats)\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "api-endpoints-usage",
    label: "api_endpoints / apiEndpoints usage after DB reduction",
    pattern: /\b(apiEndpoints|api_endpoints)\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "permission-keys-json-usage",
    label: "event_staff.permission_keys_json usage after permission normalization",
    pattern: /\bpermission_keys_json\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "video-softwares-write",
    label: "video_softwares / replaceVideoSoftwareLabels 利用（used_software_json へ移行中）",
    pattern: /\b(videoSoftwares|replaceVideoSoftwareLabels)\b/g,
    prefixAllow: [
      ...PREFIX_ALLOW,
      "src/lib/db/software.ts",
      "src/lib/actions/video.ts",
    ],
  },
];

/** 違反ルール: 各パターンとその allowlist */
const RULES = [
  {
    id: "video-comments-usage",
    label: "削除済み video_comments / videoComments 利用",
    pattern: /\b(videoComments|video_comments)\b/g,
  },
  {
    id: "outro-comment-write",
    label: "outro_comment 新規書き込み",
    // `outro_comment:` のオブジェクトリテラル形式に絞る (insert/update 用法)
    pattern: /\boutro_comment\s*:/g,
    // 表示用 (`video.outro_comment` プロパティアクセス) は対象外
  },
  {
    id: "marker-kind-non-chapter",
    label: 'marker_kind に "chapter" 以外をセット',
    // marker_kind: "comment" / "review" / "system" の "値" 代入のみ検出。
    // 末尾に [,;})] が続く場合のみ "値" と判定し、`|`(型ユニオン)は除外する。
    pattern:
      /marker_kind\s*[:=]\s*['"](comment|review|system)['"]\s*(?=[,;}\)\r\n]|$)/g,
  },
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") {
        continue;
      }
      walk(full, files);
    } else if (st.isFile()) {
      const ext = full.slice(full.lastIndexOf("."));
      if (SCAN_EXT.has(ext)) files.push(full);
    }
  }
  return files;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function isPrefixAllowed(relPath, prefixes) {
  return prefixes.some((p) => relPath === p || relPath.startsWith(p));
}

function isAllowed(relPath) {
  return FULL_ALLOW.has(relPath) || isPrefixAllowed(relPath, PREFIX_ALLOW);
}

function isDbReductionAllowed(relPath, rule) {
  return (
    isAllowed(relPath) || isPrefixAllowed(relPath, rule.prefixAllow ?? [])
  );
}

function lineNumber(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

let violations = 0;
const all = [];

for (const sub of SCAN_DIRS) {
  const abs = join(ROOT, sub);
  for (const file of walk(abs)) {
    const rel = toPosix(relative(ROOT, file));
    if (isAllowed(rel)) continue;
    let src;
    try {
      src = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(src)) !== null) {
        const line = lineNumber(src, m.index);
        all.push({ rule: rule.id, label: rule.label, file: rel, line, hit: m[0] });
        violations++;
      }
    }
    for (const rule of DB_REDUCTION_RULES) {
      if (isDbReductionAllowed(rel, rule)) continue;
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(src)) !== null) {
        const line = lineNumber(src, m.index);
        all.push({ rule: rule.id, label: rule.label, file: rel, line, hit: m[0] });
        violations++;
      }
    }
  }
}

if (violations === 0) {
  console.log("OK: no deprecated DB usage detected.");
  process.exit(0);
}

console.error(`Detected ${violations} deprecated DB usage hit(s):\n`);
const byRule = new Map();
for (const v of all) {
  let list = byRule.get(v.rule);
  if (!list) {
    list = { label: v.label, items: [] };
    byRule.set(v.rule, list);
  }
  list.items.push(v);
}
for (const [id, { label, items }] of byRule) {
  console.error(`[${id}] ${label}: ${items.length} hit(s)`);
  for (const it of items) {
    console.error(`  - ${it.file}:${it.line}  ${it.hit}`);
  }
  console.error("");
}
process.exit(1);
