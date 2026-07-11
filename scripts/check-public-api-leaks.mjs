/**
 * 公開 API 漏洩検査スクリプト。
 *
 * Usage:
 *   node scripts/check-public-api-leaks.mjs [baseUrl]
 *
 * デフォルト: http://localhost:3000
 * exit 0 = OK
 * exit 1 = 禁止キー検出
 * exit 2 = fetch 失敗 (サーバー未起動)
 * exit 3 = HTTP / JSON 応答異常
 *
 * NOTE: publicDto.ts に依存しないよう禁止キーをここに再掲する。
 */

const baseUrl = process.argv[2] ?? "http://localhost:3000";

/** publicDto.ts の FORBIDDEN_PUBLIC_KEYS と同内容。 */
const FORBIDDEN_KEYS = new Set([
  // 個人特定 ID
  "submitted_by_user_id",
  "user_id",
  "actor_user_id",
  "operator_user_id",
  "approved_by_user_id",
  "recipient_user_id",
  "reserved_by_user_id",
  "discord_id",
  "linked_user_id",
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
    return { kind: "fetch_error" };
  }
  if (!res.ok) {
    console.error(`[HTTP ${res.status}] ${url}`);
    return { kind: "http_error", status: res.status };
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    console.error(`[invalid json] ${url}: ${err.message}`);
    return { kind: "invalid_json" };
  }
  return { kind: "ok", violations: findForbiddenKeys(json) };
}

async function discoverVideoDetailEndpoint() {
  try {
    const res = await fetch(`${baseUrl}/api/videos?limit=1`);
    if (!res.ok) return null;
    const json = await res.json();
    const id = json?.items?.[0]?.id;
    if (typeof id !== "string" || id.trim() === "") return null;
    return `${baseUrl}/api/videos/${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

const endpoints = [
  `${baseUrl}/api/videos?limit=5`,
  `${baseUrl}/api/videos?limit=5&offset=0`,
  `${baseUrl}/api/events?limit=5`,
  `${baseUrl}/api/events?limit=1`,
];

const videoDetailEndpoint = await discoverVideoDetailEndpoint();
if (videoDetailEndpoint) {
  endpoints.push(videoDetailEndpoint);
}

let hasError = false;
let fetchFailed = false;
let responseFailed = false;

for (const url of endpoints) {
  process.stdout.write(`Checking ${url} ... `);
  const result = await checkEndpoint(url);
  if (result.kind === "fetch_error") {
    fetchFailed = true;
    console.error("FETCH FAILED");
    continue;
  }
  if (result.kind === "http_error" || result.kind === "invalid_json") {
    responseFailed = true;
    console.error("RESPONSE FAILED");
    continue;
  }
  const { violations } = result;
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
  process.exitCode = 2;
} else if (responseFailed) {
  console.error("\nOne or more public API endpoints returned an HTTP error or invalid JSON.");
  process.exitCode = 3;
} else if (hasError) {
  console.error("\nForbidden keys detected in public API responses.");
  process.exitCode = 1;
} else {
  console.log("\nAll public API endpoints passed the forbidden-key check.");
  process.exitCode = 0;
}
