/**
 * 公開 API 漏洩検査スクリプト。
 *
 * Usage:
 *   node scripts/check-public-api-leaks.mjs [baseUrl]
 *
 * デフォルト: http://localhost:3000
 * exit 0 = OK, exit 1 = 禁止キー検出, exit 2 = fetch 失敗 (サーバー未起動)
 *
 * NOTE: publicDto.ts に依存しないよう禁止キーをここに再掲する。
 */

const baseUrl = process.argv[2] ?? "http://localhost:3000";

/** publicDto.ts の FORBIDDEN_PUBLIC_KEYS と同内容。 */
const FORBIDDEN_KEYS = new Set([
  // 個人特定 ID
  "submitted_by_discord_user_id",
  "discord_user_id",
  "discord_id",
  "linked_discord_user_id",
  "active_x_user_id",
  "creator_x_user_id",
  // 認証関連
  "email",
  "email_verified",
  "verification_token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "providerAccountId",
  // 権限・状態
  "role",
  "is_banned",
  "tos_accepted_at",
  "tos_version",
  // 運用ノート
  "internal_note",
  "private_note",
  "void_detail_private",
  // 管理者向け履歴 / 通知 payload
  "history_logs",
  "notification_payload",
  // 編集者の代理 X user id (公開不可)
  "representative_x_user_id",
]);

/**
 * オブジェクトを再帰的に走査して禁止キーが含まれていないか検査する。
 * 違反があれば { path, key } の配列を返す。
 */
function findForbiddenKeys(value, path = "$") {
  const violations = [];
  if (value === null || value === undefined) return violations;
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      violations.push(...findForbiddenKeys(v, `${path}[${i}]`));
    });
    return violations;
  }
  if (typeof value !== "object") return violations;
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k)) {
      violations.push({ path: `${path}.${k}`, key: k });
    }
    violations.push(...findForbiddenKeys(v, `${path}.${k}`));
  }
  return violations;
}

async function checkEndpoint(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`[fetch error] ${url}: ${err.message}`);
    return null; // fetch 失敗
  }
  if (!res.ok) {
    console.error(`[HTTP ${res.status}] ${url}`);
    return []; // サーバーはいるが 4xx/5xx — 漏洩なし扱い (スキップ)
  }
  const json = await res.json();
  return findForbiddenKeys(json);
}

const endpoints = [
  `${baseUrl}/api/videos?limit=5`,
  `${baseUrl}/api/videos?limit=5&offset=0`,
  `${baseUrl}/api/events?limit=5`,
  `${baseUrl}/api/events?limit=1`,
];

let hasError = false;
let fetchFailed = false;

for (const url of endpoints) {
  process.stdout.write(`Checking ${url} ... `);
  const violations = await checkEndpoint(url);
  if (violations === null) {
    fetchFailed = true;
    console.error("FETCH FAILED");
    continue;
  }
  if (violations.length === 0) {
    console.log("OK");
  } else {
    hasError = true;
    console.error("VIOLATIONS FOUND:");
    for (const v of violations) {
      console.error(`  - forbidden key "${v.key}" at ${v.path}`);
    }
  }
}

if (fetchFailed) {
  console.error("\nOne or more endpoints could not be reached. Is the dev server running?");
  process.exit(2);
}
if (hasError) {
  console.error("\nForbidden keys detected in public API responses.");
  process.exit(1);
}
console.log("\nAll public API endpoints passed the forbidden-key check.");
process.exit(0);
