#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertCommitSha, normalizedUrl } from "./cloudflare-production.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
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

export async function runSmoke({
  env = process.env,
  repoRoot = process.cwd(),
  expectedCommit,
  fetchImpl = fetch,
  requestOptions,
} = {}) {
  const settings = smokeEnvironment({ env, repoRoot, expectedCommit });
  const get = (url, options, label) =>
    requestWithRetry(fetchImpl, url, options, label, requestOptions);

  const top = await get(settings.web, {}, "top page");
  assertStatus(top, [200], "top page");
  const html = await top.text();
  const assetPath = html.match(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/i)?.[1];
  if (!assetPath) throw new Error("top page: no Next.js static asset was found.");
  const assetUrl = new URL(assetPath, `${settings.web}/`);
  if (assetUrl.origin !== new URL(settings.web).origin) {
    throw new Error("top page: static asset must use the production web origin.");
  }
  const asset = await get(assetUrl.href, {}, "static asset");
  assertStatus(asset, [200], "static asset");

  const health = await get(`${settings.web}/api/health`, {}, "web health");
  assertStatus(health, [200], "web health");
  const healthBody = await parseJson(health, "web health");
  assertKeys(healthBody, ["ok", "service", "commit", "runtime"], "web health");
  if (
    healthBody.ok !== true ||
    healthBody.service !== "flamenode-web" ||
    healthBody.runtime !== "cloudflare-worker" ||
    healthBody.commit !== settings.commit
  ) {
    throw new Error("web health: invalid payload or commit mismatch.");
  }

  const auth = await get(`${settings.web}/api/auth/callback/discord`, {}, "auth callback");
  if (auth.status >= 500 || auth.status === 404) {
    throw new Error(`auth callback: unexpected status ${auth.status}.`);
  }

  for (const [service, baseUrl] of settings.workers) {
    const response = await get(`${baseUrl}/health`, {}, `${service} health`);
    assertStatus(response, [200], `${service} health`);
    const body = await parseJson(response, `${service} health`);
    assertKeys(body, ["ok", "service", "commit"], `${service} health`);
    if (body.ok !== true || body.service !== service || body.commit !== settings.commit) {
      throw new Error(`${service} health: invalid payload or commit mismatch.`);
    }
  }

  const contentUrl = settings.workers.find(([service]) => service === "flamenode-content-jobs")[1];
  for (const endpoint of ["/rebuild", "/process-queue"]) {
    const response = await get(contentUrl + endpoint, { method: "POST" }, `content-jobs ${endpoint}`);
    assertStatus(response, [401, 403], `content-jobs ${endpoint} unauthenticated rejection`);
  }

  const deepUnauthenticated = await get(
    `${settings.web}/api/health/deep`,
    {},
    "deep health unauthenticated rejection",
  );
  assertStatus(deepUnauthenticated, [401], "deep health unauthenticated rejection");

  const deep = await get(
    `${settings.web}/api/health/deep`,
    { headers: { Authorization: `Bearer ${settings.token}` } },
    "deep health",
  );
  assertStatus(deep, [200], "deep health");
  const deepBody = await parseJson(deep, "deep health");
  assertKeys(deepBody, ["ok", "service", "commit", "checks"], "deep health");
  assertKeys(deepBody.checks, ["d1", "kv", "r2", "schema"], "deep health checks");
  if (
    deepBody.ok !== true ||
    deepBody.service !== "flamenode-web" ||
    deepBody.commit !== settings.commit ||
    ["d1", "kv", "r2", "schema"].some((name) => deepBody.checks[name] !== "ok")
  ) {
    throw new Error("deep health: D1/KV/R2/schema read-only check failed or commit mismatched.");
  }

  const publicApi = await get(`${settings.web}/api/videos?limit=1`, {}, "public videos DTO");
  assertStatus(publicApi, [200], "public videos DTO");
  const publicBody = await parseJson(publicApi, "public videos DTO");
  assertKeys(publicBody, ["items", "total", "page", "limit"], "public videos DTO");
  if (!Array.isArray(publicBody.items) || publicBody.page !== 1 || publicBody.limit !== 1) {
    throw new Error("public videos DTO: invalid pagination payload.");
  }
  assertNoForbiddenKeys(publicBody, "public videos DTO");

  const missing = await get(
    `${settings.web}/__flamenode-smoke-missing-${settings.commit.slice(0, 12)}`,
    {},
    "404 probe",
  );
  assertStatus(missing, [404], "404 probe");
  const invalidMethod = await get(`${settings.web}/api/health`, { method: "POST" }, "invalid method probe");
  assertStatus(invalidMethod, [405], "invalid method probe");

  console.log("[smoke-cloudflare] OK (web, assets, auth, 3 cron, deep health, DTO, 404, method)");
  return { commit: settings.commit };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    await runSmoke();
  } catch (error) {
    console.error(`[smoke-cloudflare] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
