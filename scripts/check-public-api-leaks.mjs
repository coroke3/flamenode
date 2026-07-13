import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const liveIndex = args.indexOf("--live");
const liveBaseUrl = liveIndex >= 0 ? args[liveIndex + 1] : null;

const FORBIDDEN_KEYS = new Set([
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
  "email",
  "email_verified",
  "verification_token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "providerAccountId",
  "role",
  "is_banned",
  "tos_accepted_at",
  "tos_version",
  "internal_note",
  "private_note",
  "void_detail_private",
  "history_logs",
  "notification_payload",
  "representative_x_user_id",
  "is_active",
  "is_entry_open",
  "is_archived",
  "custom_questions",
  "stage_permission",
]);

function findForbiddenKeys(value, currentPath = "$") {
  const violations = [];
  if (value === null || value === undefined) return violations;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      violations.push(...findForbiddenKeys(item, `${currentPath}[${index}]`));
    });
    return violations;
  }
  if (typeof value !== "object") return violations;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      violations.push({ path: `${currentPath}.${key}`, key });
    }
    violations.push(...findForbiddenKeys(nested, `${currentPath}.${key}`));
  }
  return violations;
}

function requirePattern(relative, pattern, message, errors) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) {
    errors.push(`${relative}: fileがありません。`);
    return;
  }
  const body = fs.readFileSync(target, "utf8");
  if (!pattern.test(body)) errors.push(`${relative}: ${message}`);
}

function runStaticCheck() {
  const errors = [];
  requirePattern(
    "src/lib/api/publicDto.ts",
    /PUBLIC_VIDEO_KEYS[\s\S]*PUBLIC_EVENT_KEYS[\s\S]*FORBIDDEN_PUBLIC_KEYS/,
    "公開動画・eventのallowlistと禁止key集合がありません。",
    errors,
  );
  requirePattern(
    "src/lib/api/publicDto.ts",
    /MAX_PUBLIC_LIST_LIMIT\s*=\s*\d+[\s\S]*MAX_PUBLIC_EVENT_LIMIT\s*=\s*\d+/,
    "公開一覧の絶対上限がありません。",
    errors,
  );
  requirePattern(
    "app/api/videos/route.ts",
    /pickKeys\(row, PUBLIC_VIDEO_KEYS\)[\s\S]*assertNoForbiddenKeys\(payload\)/,
    "作品一覧が公開DTO allowlistと禁止key検査を通っていません。",
    errors,
  );
  requirePattern(
    "app/api/videos/[id]/route.ts",
    /PUBLIC_VIDEO_KEYS[\s\S]*assertNoForbiddenKeys/,
    "作品詳細が公開DTO契約を通っていません。",
    errors,
  );
  requirePattern(
    "app/api/events/route.ts",
    /pickKeys\(row, PUBLIC_EVENT_KEYS\)[\s\S]*assertNoForbiddenKeys/,
    "event一覧が公開DTO allowlistと禁止key検査を通っていません。",
    errors,
  );
  requirePattern(
    "src/lib/db/listQueries.ts",
    /visibility_status[\s\S]*public/,
    "公開作品queryのpublic判定を確認できません。",
    errors,
  );

  if (errors.length > 0) {
    for (const error of errors) console.error(`[check:public-api-leaks] ${error}`);
    process.exit(1);
  }
  console.log(
    "[check:public-api-leaks] OK: public DTO allowlists, bounded limits, route sanitization, and public query contracts are present.",
  );
}

async function checkEndpoint(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error(`[fetch error] ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "fetch_error" };
  }
  if (!response.ok) {
    console.error(`[HTTP ${response.status}] ${url}`);
    return { kind: "http_error" };
  }
  try {
    const json = await response.json();
    return { kind: "ok", violations: findForbiddenKeys(json) };
  } catch (error) {
    console.error(`[invalid json] ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "invalid_json" };
  }
}

async function runLiveCheck(baseUrl) {
  if (!/^https?:\/\//i.test(baseUrl ?? "")) {
    console.error("Usage: node scripts/check-public-api-leaks.mjs --live <baseUrl>");
    process.exit(3);
  }
  const normalized = baseUrl.replace(/\/$/, "");
  const endpoints = [
    `${normalized}/api/videos?limit=5`,
    `${normalized}/api/videos?limit=5&page=1`,
    `${normalized}/api/events?limit=5`,
  ];
  try {
    const listResponse = await fetch(`${normalized}/api/videos?limit=1`);
    if (listResponse.ok) {
      const listJson = await listResponse.json();
      const id = listJson?.items?.[0]?.id;
      if (typeof id === "string" && id.trim()) {
        endpoints.push(`${normalized}/api/videos/${encodeURIComponent(id)}`);
      }
    }
  } catch {
    // 各endpoint検査で到達不能を明示する。
  }

  let exitCode = 0;
  for (const url of endpoints) {
    const result = await checkEndpoint(url);
    if (result.kind === "fetch_error") {
      exitCode = Math.max(exitCode, 2);
      continue;
    }
    if (result.kind !== "ok") {
      exitCode = Math.max(exitCode, 3);
      continue;
    }
    if (result.violations.length > 0) {
      exitCode = Math.max(exitCode, 1);
      for (const violation of result.violations) {
        console.error(
          `[check:public-api-leaks] forbidden key "${violation.key}" at ${violation.path}`,
        );
      }
    }
  }
  if (exitCode !== 0) process.exit(exitCode);
  console.log("[check:public-api-leaks] OK: live public API responses contain no forbidden keys.");
}

if (liveIndex >= 0) await runLiveCheck(liveBaseUrl);
else runStaticCheck();
