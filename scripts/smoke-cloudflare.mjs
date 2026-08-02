#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertCommitSha, normalizedUrl } from "./cloudflare-production.mjs";
import { markDeploySmokeResult } from "./deploy-manifest.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** Workers deploy can lag behind wrangler success; allow ~2 min before failing smoke. */
const DEFAULT_PROPAGATION_ATTEMPTS = 60;
const DEFAULT_PROPAGATION_RETRY_DELAY_MS = 2_000;

function propagationRequestOptions(env = process.env, requestOptions = {}) {
  const attemptsRaw = env.SMOKE_PROPAGATION_ATTEMPTS?.trim();
  const delayRaw = env.SMOKE_PROPAGATION_DELAY_MS?.trim();
  const attempts = attemptsRaw ? Number.parseInt(attemptsRaw, 10) : DEFAULT_PROPAGATION_ATTEMPTS;
  const retryDelayMs = delayRaw ? Number.parseInt(delayRaw, 10) : DEFAULT_PROPAGATION_RETRY_DELAY_MS;
  return {
    attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : DEFAULT_PROPAGATION_ATTEMPTS,
    retryDelayMs:
      Number.isFinite(retryDelayMs) && retryDelayMs >= 0
        ? retryDelayMs
        : DEFAULT_PROPAGATION_RETRY_DELAY_MS,
    ...requestOptions,
  };
}
const PUBLIC_FORBIDDEN_KEYS = new Set([
  "access_token",
  "active_x_user_id",
  "discord_id",
  "email",
  "internal_note",
  "is_banned",
  "linked_discord_user_id",
  "linked_user_id",
  "refresh_token",
  "role",
  "verification_token",
]);

function requiredUrl(env, name) {
  const raw = env[name]?.trim();
  if (!raw) throw new Error(`${name} is required; smoke checks are never skipped.`);
  try {
    return normalizedUrl(raw, name);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
}

function assertNoForbiddenKeys(value, pathLabel = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (PUBLIC_FORBIDDEN_KEYS.has(key)) throw new Error(`${pathLabel}: forbidden public key ${key}`);
    assertNoForbiddenKeys(item, `${pathLabel}.${key}`);
  }
}

function assertKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: JSON object is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: unexpected key ${key}`);
  }
}

async function parseJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: malformed JSON response.`);
  }
}

async function requestWithRetry(
  fetchImpl,
  url,
  options,
  label,
  { attempts = 3, timeoutMs = 10_000, retryDelayMs = 250 } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if ([502, 503, 504].includes(response.status) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
    }
  }
  throw new Error(`${label}: request failed after ${attempts} attempts (${lastError?.name ?? "network_error"}).`);
}

function assertStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    throw new Error(`${label}: unexpected status ${response.status}.`);
  }
}

/** Degraded D1 banner may clear shortly after deploy; retry before failing smoke. */
const DEFAULT_DEGRADED_ATTEMPTS = 3;
const DEFAULT_DEGRADED_RETRY_DELAY_MS = 3_000;

function degradedRetryOptions(env = process.env, requestOptions = {}) {
  const attemptsRaw = env.SMOKE_DEGRADED_ATTEMPTS?.trim();
  const delayRaw = env.SMOKE_DEGRADED_DELAY_MS?.trim();
  const attempts = attemptsRaw
    ? Number.parseInt(attemptsRaw, 10)
    : DEFAULT_DEGRADED_ATTEMPTS;
  const retryDelayMs = delayRaw
    ? Number.parseInt(delayRaw, 10)
    : DEFAULT_DEGRADED_RETRY_DELAY_MS;
  return {
    attempts:
      Number.isFinite(attempts) && attempts > 0
        ? attempts
        : DEFAULT_DEGRADED_ATTEMPTS,
    retryDelayMs:
      Number.isFinite(retryDelayMs) && retryDelayMs >= 0
        ? retryDelayMs
        : DEFAULT_DEGRADED_RETRY_DELAY_MS,
    ...requestOptions,
  };
}

function isDegradedD1Banner(html) {
  return html.includes("簡易表示:");
}

async function fetchHtmlWithDegradedRetry(
  get,
  url,
  label,
  { attempts = DEFAULT_DEGRADED_ATTEMPTS, retryDelayMs = DEFAULT_DEGRADED_RETRY_DELAY_MS } = {},
) {
  let lastHtml = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await get(url, {}, label);
    assertStatus(response, [200], label);
    lastHtml = await response.text();
    if (!isDegradedD1Banner(lastHtml)) {
      return lastHtml;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`${label}: degraded D1 banner detected.`);
}

/** R2 直読が無い smoke 向け。空一覧でも骨格が壊れていない・degraded だけでないことを弱く確認する。 */
function assertWeakPublicListShell(html, label) {
  if (!html.includes("作品一覧")) {
    throw new Error(`${label}: missing list page title marker.`);
  }
  // Next.js は隣接テキストに `<!-- -->` を挟むことがあるため、コメントを除いて照合する。
  const listText = html.replace(/<!--[\s\S]*?-->/g, "");
  if (!/\d[\d,]*\s*works/.test(listText)) {
    throw new Error(`${label}: missing works count marker.`);
  }
  if (html.includes("簡易表示:")) {
    throw new Error(`${label}: degraded D1 banner detected.`);
  }
  if (html.includes("このイベントの作品一覧を一時的に表示できません")) {
    throw new Error(`${label}: unavailable event list message detected.`);
  }
  const hasStructure =
    html.includes("fn-list-toolbar") ||
    html.includes("fn-list-grid") ||
    html.includes("fn-empty") ||
    html.includes("fn-list-compact");
  if (!hasStructure) {
    throw new Error(`${label}: list page structure markers missing.`);
  }
}

/** トップの棚・カード骨格。一覧が空でも新着セクションが壊れていないことを弱く確認する。 */
function assertWeakTopPublicShell(html, label) {
  if (html.includes("簡易表示:")) {
    throw new Error(`${label}: degraded D1 banner detected.`);
  }
  const hasShelfOrCard =
    html.includes("fn-vcard") ||
    html.includes("fn-shelf") ||
    html.includes("sec-latest") ||
    html.includes("新着アップロード");
  if (!hasShelfOrCard) {
    throw new Error(`${label}: missing shelf/video card structure markers.`);
  }
}

async function requestJsonUntilValid(
  fetchImpl,
  url,
  options,
  label,
  validate,
  {
    attempts = DEFAULT_PROPAGATION_ATTEMPTS,
    timeoutMs = 10_000,
    retryDelayMs = DEFAULT_PROPAGATION_RETRY_DELAY_MS,
  } = {},
) {
  let lastError = new Error(`${label}: no response was received.`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await requestWithRetry(
        fetchImpl,
        url,
        options,
        label,
        { attempts: 1, timeoutMs, retryDelayMs: 0 },
      );
      assertStatus(response, [200], label);
      const body = await parseJson(response, label);
      validate(body);
      return body;
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error(`${label}: response validation failed.`);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(
    `${lastError.message} (deployment propagation did not converge after ${attempts} attempts.)`,
  );
}

export function smokeEnvironment({
  env = process.env,
  repoRoot = process.cwd(),
  expectedCommit,
} = {}) {
  const commit = expectedCommit ?? assertCommitSha(env, repoRoot);
  if (!SHA_PATTERN.test(commit)) throw new Error("WORKERS_CI_COMMIT_SHA must be a 40-character hexadecimal SHA.");
  const token = env.WORKER_ADMIN_TOKEN?.trim();
  if (!token) throw new Error("WORKER_ADMIN_TOKEN is required for protected deep health.");
  return {
    commit: commit.toLowerCase(),
    token,
    web: requiredUrl(env, "FLAMENODE_WEB_URL"),
    workers: [
      ["flamenode-fast-jobs", requiredUrl(env, "FAST_JOBS_URL")],
      ["flamenode-content-jobs", requiredUrl(env, "CONTENT_JOBS_URL")],
      ["flamenode-sync-jobs", requiredUrl(env, "SYNC_JOBS_URL")],
    ],
  };
}

function validateWebHealthBody(settings, healthBody) {
  assertKeys(healthBody, ["ok", "service", "commit", "runtime"], "web health");
  if (
    healthBody.ok !== true ||
    healthBody.service !== "flamenode-web" ||
    healthBody.runtime !== "cloudflare-worker" ||
    healthBody.commit !== settings.commit
  ) {
    throw new Error("web health: invalid payload or commit mismatch.");
  }
}

function validateCronHealthBody(settings, service, body) {
  assertKeys(body, ["ok", "service", "commit"], `${service} health`);
  if (body.ok !== true || body.service !== service || body.commit !== settings.commit) {
    throw new Error(`${service} health: invalid payload or commit mismatch.`);
  }
}

function validateDeepHealthBody(settings, body) {
  assertKeys(
    body,
    ["ok", "service", "commit", "checks", "status", "public_visibility_guard_mode"],
    "deep health",
  );
  assertKeys(
    body.checks,
    ["d1", "kv", "r2", "schema", "queues", "static_artifacts", "public_visibility"],
    "deep health checks",
  );
  const guardMode = body.public_visibility_guard_mode;
  if (
    guardMode !== undefined &&
    guardMode !== "off" &&
    guardMode !== "observe" &&
    guardMode !== "enforce"
  ) {
    throw new Error("deep health: public_visibility_guard_mode must be off, observe, or enforce.");
  }
  if (
    body.ok !== true ||
    body.status !== "ok" ||
    body.service !== "flamenode-web" ||
    body.commit !== settings.commit ||
    ["d1", "kv", "r2", "schema", "queues", "static_artifacts", "public_visibility"].some(
      (name) => body.checks[name] !== "ok",
    )
  ) {
    throw new Error("deep health: D1/KV/R2/schema/queues/static/visibility checks failed or commit mismatched.");
  }
}

const PUBLIC_VIDEO_ITEM_KEYS = [
  "id",
  "title",
  "youtube_video_id",
  "display_name",
  "icon_url",
  "primary_event_id",
  "scheduled_time",
  "status",
];

function assertPublicVideosPayload(body, label) {
  assertKeys(body, ["items", "total", "page", "limit"], label);
  if (!Array.isArray(body.items) || body.page !== 1) {
    throw new Error(`${label}: invalid pagination payload.`);
  }
  if (!Number.isFinite(body.total) || body.total < 0) {
    throw new Error(`${label}: invalid total.`);
  }
  if (body.items.length > body.limit) {
    throw new Error(`${label}: items length exceeds limit.`);
  }
  for (const [index, item] of body.items.entries()) {
    assertKeys(item, PUBLIC_VIDEO_ITEM_KEYS, `${label}.items[${index}]`);
    if (item.status !== "public") {
      throw new Error(`${label}.items[${index}]: status must be public.`);
    }
  }
  assertNoForbiddenKeys(body, label);
}

function parseWorksCountFromListHtml(html) {
  const listText = html.replace(/<!--[\s\S]*?-->/g, "");
  const match = listText.match(/(\d[\d,]*)\s*works/);
  if (!match) return null;
  return Number.parseInt(match[1].replaceAll(",", ""), 10);
}

async function waitForProductionHealthConvergence(fetchImpl, settings, propagationOptions) {
  await Promise.all([
    requestJsonUntilValid(
      fetchImpl,
      `${settings.web}/api/health`,
      {},
      "web health",
      (body) => validateWebHealthBody(settings, body),
      propagationOptions,
    ),
    ...settings.workers.map(([service, baseUrl]) =>
      requestJsonUntilValid(
        fetchImpl,
        `${baseUrl}/health`,
        {},
        `${service} health`,
        (body) => validateCronHealthBody(settings, service, body),
        propagationOptions,
      ),
    ),
    requestJsonUntilValid(
      fetchImpl,
      `${settings.web}/api/health/deep`,
      { headers: { Authorization: `Bearer ${settings.token}` } },
      "deep health",
      (body) => validateDeepHealthBody(settings, body),
      propagationOptions,
    ),
  ]);
}

export async function runSmoke({
  env = process.env,
  repoRoot = process.cwd(),
  expectedCommit,
  fetchImpl = fetch,
  requestOptions,
} = {}) {
  const settings = smokeEnvironment({ env, repoRoot, expectedCommit });
  const propagationOptions = propagationRequestOptions(env, requestOptions);
  const degradedOptions = degradedRetryOptions(env, requestOptions);
  const get = (url, options, label) =>
    requestWithRetry(fetchImpl, url, options, label, requestOptions);

  await waitForProductionHealthConvergence(fetchImpl, settings, propagationOptions);

  const topHtml = await fetchHtmlWithDegradedRetry(
    get,
    settings.web,
    "top page",
    degradedOptions,
  );
  assertWeakTopPublicShell(topHtml, "top page");
  const assetPath = topHtml.match(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/i)?.[1];
  if (!assetPath) throw new Error("top page: no Next.js static asset was found.");
  const assetUrl = new URL(assetPath, `${settings.web}/`);
  if (assetUrl.origin !== new URL(settings.web).origin) {
    throw new Error("top page: static asset must use the production web origin.");
  }
  const asset = await get(assetUrl.href, {}, "static asset");
  assertStatus(asset, [200], "static asset");

  const listHtml = await fetchHtmlWithDegradedRetry(
    get,
    `${settings.web}/list`,
    "list page",
    degradedOptions,
  );
  assertWeakPublicListShell(listHtml, "list page");

  const legacyImport = await get(
    `${settings.web}/api/admin/import/legacy`,
    {
      method: "POST",
      headers: { Origin: new URL(settings.web).origin },
    },
    "legacy import unauthenticated rejection",
  );
  assertStatus(legacyImport, [401, 403], "legacy import unauthenticated rejection");

  const auth = await get(`${settings.web}/api/auth/callback/discord`, {}, "auth callback");
  if (auth.status >= 500 || auth.status === 404) {
    throw new Error(`auth callback: unexpected status ${auth.status}.`);
  }

  const contentUrl = settings.workers.find(([service]) => service === "flamenode-content-jobs")[1];
  for (const endpoint of ["/rebuild", "/process-queue"]) {
    const response = await get(
      contentUrl + endpoint,
      {
        method: "POST",
        // Explicit empty body so edge proxies do not invent a non-zero payload.
        headers: { "Content-Length": "0" },
      },
      `content-jobs ${endpoint}`,
    );
    assertStatus(response, [401, 403], `content-jobs ${endpoint} unauthenticated rejection`);
  }

  const deepUnauthenticated = await get(
    `${settings.web}/api/health/deep`,
    {},
    "deep health unauthenticated rejection",
  );
  assertStatus(deepUnauthenticated, [401], "deep health unauthenticated rejection");

  const publicApi = await get(`${settings.web}/api/videos?limit=5`, {}, "public videos DTO");
  assertStatus(publicApi, [200], "public videos DTO");
  const publicBody = await parseJson(publicApi, "public videos DTO");
  assertPublicVideosPayload(publicBody, "public videos DTO");
  if (publicBody.limit !== 5) {
    throw new Error("public videos DTO: unexpected limit.");
  }
  const listWorksCount = parseWorksCountFromListHtml(listHtml);
  if (
    listWorksCount !== null &&
    Number.isFinite(publicBody.total) &&
    publicBody.total < listWorksCount
  ) {
    throw new Error(
      "public videos DTO: total is lower than list page works count marker.",
    );
  }

  const missing = await get(
    `${settings.web}/__flamenode-smoke-missing-${settings.commit.slice(0, 12)}`,
    {},
    "404 probe",
  );
  assertStatus(missing, [404], "404 probe");
  const invalidMethod = await get(`${settings.web}/api/health`, { method: "POST" }, "invalid method probe");
  assertStatus(invalidMethod, [405], "invalid method probe");

  console.log(
    "[smoke-cloudflare] OK (health convergence, web, assets, list shell, top shell, legacy import guard, auth, cron admin guard, deep health auth, DTO, count consistency, 404, method)",
  );
  return { commit: settings.commit };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    await runSmoke();
    markDeploySmokeResult(process.cwd(), { ok: true });
  } catch (error) {
    markDeploySmokeResult(process.cwd(), { ok: false });
    console.error(`[smoke-cloudflare] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
