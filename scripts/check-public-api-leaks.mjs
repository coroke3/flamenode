import fs from "node:fs";
import path from "node:path";
import { findForbiddenPublicKeys } from "../src/lib/api/publicDto.ts";

const root = process.cwd();
const args = process.argv.slice(2);
const liveIndex = args.indexOf("--live");
const liveBaseUrl = liveIndex >= 0 ? args[liveIndex + 1] : null;
const LIVE_FETCH_TIMEOUT_MS = 10_000;

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
    /MAX_PUBLIC_LIST_LIMIT\s*=\s*\d+[\s\S]*MAX_PUBLIC_EVENT_LIMIT\s*=\s*\d+[\s\S]*MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT\s*=\s*\d+/,
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
    "app/api/public/events/[id]/staff/route.ts",
    /normalizePublicEventStaffArtifact[\s\S]*assertNoForbiddenKeys\(payload\)/,
    "PVSF staff APIが専用公開DTOと禁止key検査を通っていません。",
    errors,
  );
  requirePattern(
    "app/api/software/suggestions/route.ts",
    /parseBoundedPositiveInt\([\s\S]*MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT[\s\S]*activeSoftware\s*=\s*eq\(softwareCatalog\.is_active,\s*1\)[\s\S]*\.where\(activeSoftware\)[\s\S]*\.where\(and\(activeSoftware,\s*inArray\([\s\S]*\.where\([\s\S]*and\(activeSoftware,[\s\S]*toPublicSoftwareSuggestionDto[\s\S]*assertNoForbiddenKeys\(payload\)/,
    "software候補が正数上限、active限定、公開DTO、禁止key検査を通っていません。",
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

function fetchWithTimeout(url) {
  return fetch(url, {
    signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
  });
}

async function checkEndpoint(url) {
  let response;
  try {
    response = await fetchWithTimeout(url);
  } catch (error) {
    console.error(
      `[fetch error] ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { kind: "fetch_error" };
  }
  if (!response.ok) {
    console.error(`[HTTP ${response.status}] ${url}`);
    return { kind: "http_error" };
  }
  try {
    const json = await response.json();
    return { kind: "ok", violations: findForbiddenPublicKeys(json) };
  } catch (error) {
    console.error(
      `[invalid json] ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { kind: "invalid_json" };
  }
}

async function runLiveCheck(baseUrl) {
  if (!/^https?:\/\//i.test(baseUrl ?? "")) {
    console.error("Usage: node scripts/check-public-api-leaks.mjs --live <baseUrl>");
    process.exit(3);
  }
  const normalized = baseUrl.replace(/\/+$/, "");
  const endpoints = [
    `${normalized}/api/videos?limit=5`,
    `${normalized}/api/videos?limit=5&page=1`,
    `${normalized}/api/events?limit=5`,
    `${normalized}/api/software/suggestions?limit=5`,
  ];
  try {
    const listResponse = await fetchWithTimeout(
      `${normalized}/api/videos?limit=1`,
    );
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
  console.log(
    "[check:public-api-leaks] OK: live public API responses contain no forbidden keys.",
  );
}

if (liveIndex >= 0) await runLiveCheck(liveBaseUrl);
else runStaticCheck();
