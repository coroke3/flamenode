import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  REQUIRED_SCHEMA_VERSION,
  RUNTIME_CRITICAL_TABLES,
} from "../src/lib/health/schemaContract.ts";

export { REQUIRED_SCHEMA_VERSION, RUNTIME_CRITICAL_TABLES };

export const DEPLOY_TARGETS = Object.freeze([
  {
    key: "web",
    service: "flamenode-web",
    source: "wrangler.toml",
    output: "web.toml",
    configEnv: "CF_WEB_CONFIG",
    bindings: [
      "DB",
      "BUCKET",
      "KV",
      "ASSETS",
      "WORKER_SELF_REFERENCE",
      "NEXT_INC_CACHE_R2_BUCKET",
      "NOTIFICATION_WAKE_QUEUE",
      "STATIC_REBUILD_WAKE_QUEUE",
      "YOUTUBE_SYNC_WAKE_QUEUE",
    ],
    requiresR2: true,
  },
  {
    key: "fast-jobs",
    service: "flamenode-fast-jobs",
    source: "workers/fast-jobs/wrangler.toml",
    output: "fast-jobs.toml",
    configEnv: "CF_FAST_JOBS_CONFIG",
    bindings: ["DB", "KV", "NOTIFICATION_WAKE_QUEUE"],
    requiresR2: false,
  },
  {
    key: "content-jobs",
    service: "flamenode-content-jobs",
    source: "workers/content-jobs/wrangler.toml",
    output: "content-jobs.toml",
    configEnv: "CF_CONTENT_JOBS_CONFIG",
    bindings: ["DB", "R2", "KV", "STATIC_REBUILD_WAKE_QUEUE"],
    requiresR2: true,
  },
  {
    key: "sync-jobs",
    service: "flamenode-sync-jobs",
    source: "workers/sync-jobs/wrangler.toml",
    output: "sync-jobs.toml",
    configEnv: "CF_SYNC_JOBS_CONFIG",
    bindings: ["DB", "KV", "YOUTUBE_SYNC_WAKE_QUEUE", "STATIC_REBUILD_WAKE_QUEUE"],
    requiresR2: false,
  },
]);

export const REMOTE_SECRET_REQUIREMENTS = Object.freeze({
  web: [
    "AUTH_SECRET",
    "AUTH_DISCORD_SECRET",
    "SPREADSHEET_IMPORT_PREVIEW_SECRET",
    "WORKER_ADMIN_TOKEN",
  ],
  "fast-jobs": [],
  "content-jobs": ["WORKER_ADMIN_TOKEN"],
  "sync-jobs": [
    "YOUTUBE_API_KEY",
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REFRESH_TOKEN",
  ],
});

const REQUIRED_ENV_NAMES = Object.freeze([
  "CI",
  "NODE_VERSION",
  "SKIP_DEPENDENCY_INSTALL",
  "WORKERS_CI",
  "WORKERS_CI_BUILD_UUID",
  "WORKERS_CI_BRANCH",
  "WORKERS_CI_COMMIT_SHA",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_D1_DATABASE_ID",
  "CF_KV_NAMESPACE_ID",
  "CF_R2_BUCKET_NAME",
  "FLAMENODE_WEB_URL",
  "FAST_JOBS_URL",
  "CONTENT_JOBS_URL",
  "SYNC_JOBS_URL",
  "NEXT_PUBLIC_SITE_URL",
  "AUTH_URL",
  "AUTH_DISCORD_ID",
  "WORKER_ADMIN_TOKEN",
]);

export const SENSITIVE_ENV_NAMES = Object.freeze([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_D1_DATABASE_ID",
  "CF_KV_NAMESPACE_ID",
  "CF_R2_BUCKET_NAME",
  "AUTH_SECRET",
  "AUTH_DISCORD_SECRET",
  "SPREADSHEET_IMPORT_PREVIEW_SECRET",
  "WORKER_ADMIN_TOKEN",
  "YOUTUBE_API_KEY",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH_REFRESH_TOKEN",
  "DISCORD_BOT_TOKEN",
  "DISCORD_WEBHOOK_URL",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,254}$/i;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const ZERO_HEX = "00000000000000000000000000000000";
const PLACEHOLDER_PATTERN = /(?:placeholder|change[-_ ]?me|dummy|example|\.invalid\b)/i;

function value(env, name) {
  return typeof env[name] === "string" ? env[name].trim() : "";
}

export function isWorkersCi(env = process.env) {
  const raw = value(env, "WORKERS_CI");
  return raw === "1" || raw.toLowerCase() === "true";
}

export function rejectBareWorkersCiWranglerDeploy(env = process.env) {
  if (!isWorkersCi(env)) return;
  throw new Error(
    "Bare wrangler deploy of the tracked wrangler.toml template is forbidden in Workers CI; use npm run cf:deploy-production.",
  );
}

function stripTrackedBuildSection(content) {
  return content.replace(/^\[build\]\s*\r?\n(?:[^\r\n\[]+\r?\n)*/m, "");
}

export function normalizedUrl(raw, name) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid production HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".localhost") ||
    parsed.hostname.endsWith(".invalid")
  ) {
    throw new Error(`${name} must be a valid production HTTPS URL.`);
  }
  return parsed.origin;
}

export function gitHead(cwd = process.cwd(), exec = execFileSync) {
  try {
    return exec("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("git HEAD could not be resolved; production verification stopped.");
  }
}

export function assertCommitSha(env = process.env, cwd = process.cwd(), exec = execFileSync) {
  const sha = value(env, "WORKERS_CI_COMMIT_SHA");
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(
      "WORKERS_CI_COMMIT_SHA is required and must be exactly 40 hexadecimal characters; no fallback is allowed.",
    );
  }
  const head = gitHead(cwd, exec);
  if (sha.toLowerCase() !== head.toLowerCase()) {
    throw new Error("WORKERS_CI_COMMIT_SHA does not match git HEAD; production verification stopped.");
  }
  return sha.toLowerCase();
}

export function assertCleanGitWorktree(cwd = process.cwd(), exec = execFileSync) {
  let status;
  try {
    status = exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("git worktree status could not be verified; production stopped.");
  }
  if (String(status).trim()) {
    throw new Error("git worktree must be clean for a production deployment.");
  }
}

function assertSecretValue(env, name, errors) {
  const raw = value(env, name);
  if (!raw) return;
  if (raw.length < 8 || PLACEHOLDER_PATTERN.test(raw)) {
    errors.push(`${name} must be a non-placeholder production value`);
  }
}

export function verifyProductionEnvironment({
  env = process.env,
  cwd = process.cwd(),
  exec = execFileSync,
  requireGitHead = true,
  runtimeNodeVersion = process.versions.node,
} = {}) {
  const errors = [];
  if (value(env, "FLAMENODE_LOCAL_PREVIEW")) {
    errors.push("FLAMENODE_LOCAL_PREVIEW is local-only and forbidden in production");
  }
  if (value(env, "NODE_VERSION") !== "22") {
    errors.push("NODE_VERSION must be exactly 22 for Workers Builds");
  }
  if (value(env, "SKIP_DEPENDENCY_INSTALL") !== "true") {
    errors.push("SKIP_DEPENDENCY_INSTALL must be exactly true for Workers Builds");
  }
  const nodeMajor = Number.parseInt(String(runtimeNodeVersion).split(".")[0] ?? "", 10);
  if (nodeMajor !== 22) {
    errors.push("Node.js runtime must be major version 22 for Workers Builds");
  }
  if (value(env, "CI") !== "true") {
    errors.push("CI must be exactly true in Workers Builds");
  }
  if (value(env, "WORKERS_CI") !== "1") {
    errors.push("WORKERS_CI must be exactly 1");
  }
  if (value(env, "WORKERS_CI_BRANCH") !== "main") {
    errors.push("WORKERS_CI_BRANCH must be exactly main for production");
  }
  const buildUuid = value(env, "WORKERS_CI_BUILD_UUID");
  if (buildUuid && (!UUID_PATTERN.test(buildUuid) || buildUuid.toLowerCase() === ZERO_UUID)) {
    errors.push("WORKERS_CI_BUILD_UUID must be a non-zero UUID");
  }
  for (const name of REQUIRED_ENV_NAMES) {
    if (!value(env, name)) errors.push(`${name} is required`);
  }
  const accountId = value(env, "CLOUDFLARE_ACCOUNT_ID");
  if (accountId && (!ACCOUNT_ID_PATTERN.test(accountId) || accountId === ZERO_HEX)) {
    errors.push("CLOUDFLARE_ACCOUNT_ID must be a non-zero 32-character hexadecimal ID");
  }
  const d1Id = value(env, "CF_D1_DATABASE_ID");
  if (d1Id && (!UUID_PATTERN.test(d1Id) || d1Id.toLowerCase() === ZERO_UUID)) {
    errors.push("CF_D1_DATABASE_ID must be a non-zero UUID");
  }
  const kvId = value(env, "CF_KV_NAMESPACE_ID");
  if (kvId && (!HEX_ID_PATTERN.test(kvId) || kvId.toLowerCase() === ZERO_HEX)) {
    errors.push("CF_KV_NAMESPACE_ID must be a non-zero 32-character hexadecimal ID");
  }
  const bucket = value(env, "CF_R2_BUCKET_NAME");
  if (bucket && !SAFE_NAME_PATTERN.test(bucket)) {
    errors.push("CF_R2_BUCKET_NAME must be a safe non-empty resource name");
  }
  const authDiscordId = value(env, "AUTH_DISCORD_ID");
  if (authDiscordId && (authDiscordId.length < 8 || PLACEHOLDER_PATTERN.test(authDiscordId))) {
    errors.push("AUTH_DISCORD_ID must be a non-placeholder production client ID");
  }

  for (const name of SENSITIVE_ENV_NAMES) assertSecretValue(env, name, errors);

  const urlNames = [
    "FLAMENODE_WEB_URL",
    "FAST_JOBS_URL",
    "CONTENT_JOBS_URL",
    "SYNC_JOBS_URL",
    "NEXT_PUBLIC_SITE_URL",
    "AUTH_URL",
  ];
  const urls = new Map();
  for (const name of urlNames) {
    const raw = value(env, name);
    if (!raw) continue;
    try {
      urls.set(name, normalizedUrl(raw, name));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (
    urls.has("FLAMENODE_WEB_URL") &&
    urls.has("NEXT_PUBLIC_SITE_URL") &&
    urls.get("FLAMENODE_WEB_URL") !== urls.get("NEXT_PUBLIC_SITE_URL")
  ) {
    errors.push("NEXT_PUBLIC_SITE_URL must match FLAMENODE_WEB_URL");
  }
  if (
    urls.has("FLAMENODE_WEB_URL") &&
    urls.has("AUTH_URL") &&
    urls.get("FLAMENODE_WEB_URL") !== urls.get("AUTH_URL")
  ) {
    errors.push("AUTH_URL must match FLAMENODE_WEB_URL");
  }
  const serviceUrls = [
    urls.get("FLAMENODE_WEB_URL"),
    urls.get("FAST_JOBS_URL"),
    urls.get("CONTENT_JOBS_URL"),
    urls.get("SYNC_JOBS_URL"),
  ].filter(Boolean);
  if (new Set(serviceUrls).size !== serviceUrls.length) {
    errors.push("Worker URLs must be distinct");
  }

  let commit;
  try {
    commit = requireGitHead
      ? assertCommitSha(env, cwd, exec)
      : (() => {
          const candidate = value(env, "WORKERS_CI_COMMIT_SHA");
          if (!SHA_PATTERN.test(candidate)) {
            throw new Error("WORKERS_CI_COMMIT_SHA must be exactly 40 hexadecimal characters");
          }
          return candidate.toLowerCase();
        })();
  } catch (error) {
    errors.push(error.message);
  }
  if (requireGitHead) {
    try {
      assertCleanGitWorktree(cwd, exec);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production environment verification failed:\n- ${errors.join("\n- ")}`);
  }
  return { commit, urls: Object.fromEntries(urls) };
}

function replaceRequired(content, pattern, replacement, label, sourcePath) {
  let count = 0;
  const next = content.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
  if (count === 0) throw new Error(`${sourcePath}: required ${label} placeholder was not found.`);
  return next;
}

function injectCommitVariable(content, commit) {
  const commitLine = `BUILD_COMMIT_SHA = "${commit}"`;
  if (/^\s*BUILD_COMMIT_SHA\s*=/m.test(content)) {
    return content.replace(/^\s*BUILD_COMMIT_SHA\s*=.*$/m, commitLine);
  }
  const vars = content.match(/^\[vars\]\s*$/m);
  if (vars?.index !== undefined) {
    const insertAt = vars.index + vars[0].length;
    return `${content.slice(0, insertAt)}\n${commitLine}${content.slice(insertAt)}`;
  }
  return `${content.trimEnd()}\n\n[vars]\n${commitLine}\n`;
}

function injectAccountId(content, accountId) {
  const assignment = `account_id = "${accountId}"`;
  if (/^\s*account_id\s*=/m.test(content)) {
    return content.replace(/^\s*account_id\s*=.*$/m, assignment);
  }
  return content.replace(/^(name\s*=.*)$/m, `$1\n${assignment}`);
}

function injectStringVariable(content, name, rawValue) {
  const assignment = `${name} = ${JSON.stringify(rawValue)}`;
  const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, assignment);
  const vars = content.match(/^\[vars\]\s*$/m);
  if (vars?.index !== undefined) {
    const insertAt = vars.index + vars[0].length;
    return `${content.slice(0, insertAt)}\n${assignment}${content.slice(insertAt)}`;
  }
  return `${content.trimEnd()}\n\n[vars]\n${assignment}\n`;
}

const QUEUE_FEATURE_FLAG_NAMES = [
  "QUEUE_DISPATCH_ENABLED",
  "QUEUE_CONTINUATION_ENABLED",
  "QUEUE_YOUTUBE_SYNC_ENABLED",
];

/** Generated production config may inject "1" from Build Variables. Template stays "0". */
function validateQueueFeatureFlags(content, errors) {
  for (const name of QUEUE_FEATURE_FLAG_NAMES) {
    if (!new RegExp(`^\\s*${name}\\s*=\\s*"(?:0|1)"\\s*$`, "m").test(content)) {
      errors.push(`${name} must be "0" or "1"`);
    }
  }
}

function injectQueueFeatureFlags(content, env) {
  let output = content;
  for (const name of QUEUE_FEATURE_FLAG_NAMES) {
    const raw = env[name];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const normalized = /^(1|true|yes)$/i.test(String(raw).trim()) ? "1" : "0";
    output = injectStringVariable(output, name, normalized);
  }
  return output;
}

function validateQueueConsumerBlock(content, errors, { queue, dlq, retryDelay }) {
  const blockPattern = new RegExp(
    `\\[\\[queues\\.consumers\\]\\][\\s\\S]*?queue\\s*=\\s*"${queue}"[\\s\\S]*?(?=\\n\\[\\[|$)`,
  );
  const block = content.match(blockPattern)?.[0];
  if (!block) {
    errors.push(`queue consumer ${queue} is missing`);
    return;
  }
  const required = [
    ["max_batch_size", "10"],
    ["max_batch_timeout", "1"],
    ["max_retries", "3"],
    ["retry_delay", String(retryDelay)],
    ["dead_letter_queue", dlq],
    ["max_concurrency", "1"],
  ];
  for (const [key, expected] of required) {
    if (!new RegExp(`^\\s*${key}\\s*=\\s*${expected === dlq ? `"${expected}"` : expected}\\s*$`, "m").test(block)) {
      errors.push(`queue consumer ${queue}: ${key} must be ${expected}`);
    }
  }
}

function validateCronSchedule(content, errors, expectedCrons) {
  const declarations = [...content.matchAll(/^\s*crons\s*=\s*\[([^\]]*)\]\s*$/gm)];
  if (declarations.length !== 1) {
    errors.push("exactly one cron declaration is required");
    return;
  }
  const entries = [...declarations[0][1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const residual = declarations[0][1].replace(/"[^"]+"/g, "").replace(/[\s,]/g, "");
  if (residual || entries.length !== expectedCrons.length) {
    errors.push(`cron schedule must be ${expectedCrons.join(", ")}`);
    return;
  }
  for (const cron of expectedCrons) {
    if (!entries.includes(cron)) errors.push(`cron expression ${cron} is missing`);
  }
}

function validateProductionConfig(content, target, env, commit, relativePath) {
  const errors = [];
  if (/FLAMENODE_LOCAL_PREVIEW/.test(content)) {
    errors.push("local preview allowance is forbidden in production config");
  }
  if (!new RegExp(`^\\s*name\\s*=\\s*"${target.service}"\\s*$`, "m").test(content)) {
    errors.push(`Worker name must be ${target.service}`);
  }
  for (const binding of target.bindings) {
    if (!new RegExp(`^\\s*binding\\s*=\\s*"${binding}"\\s*$`, "m").test(content)) {
      errors.push(`required binding ${binding} is missing`);
    }
  }
  if (!content.includes(`account_id = "${value(env, "CLOUDFLARE_ACCOUNT_ID")}"`)) {
    errors.push("Cloudflare account_id is not injected");
  }
  if (!content.includes(value(env, "CF_D1_DATABASE_ID"))) errors.push("D1 production ID is not injected");
  if (!content.includes(value(env, "CF_KV_NAMESPACE_ID"))) errors.push("KV production ID is not injected");
  if (target.requiresR2 && !content.includes(value(env, "CF_R2_BUCKET_NAME"))) {
    errors.push("R2 production bucket is not injected");
  }
  if (!content.includes(`BUILD_COMMIT_SHA = "${commit}"`)) errors.push("commit SHA variable is missing");
  if (/00000000-0000-0000-0000-000000000000|00000000000000000000000000000000/.test(content)) {
    errors.push("placeholder resource ID remains");
  }
  if (/^\s*preview_id\s*=/m.test(content)) errors.push("production config must not contain preview_id");
  if (/pages_build_output_dir|\.vercel\/output|wrangler\s+pages/i.test(content)) {
    errors.push("legacy Pages configuration remains");
  }
  if (
    target.key === "web" &&
    !/^\s*main\s*=\s*"(\.\.\/)*\.open-next\/worker\.js"\s*$/m.test(content)
  ) {
    errors.push("OpenNext worker entrypoint is missing");
  }
  if (target.key === "web") {
    if (!/^\s*service\s*=\s*"flamenode-web"\s*$/m.test(content)) {
      errors.push("OpenNext self-service target is missing");
    }
    for (const name of ["NEXT_PUBLIC_SITE_URL", "AUTH_URL", "AUTH_DISCORD_ID"]) {
      const assignment = `${name} = ${JSON.stringify(value(env, name))}`;
      if (!content.includes(assignment)) errors.push(`${name} runtime variable is missing`);
    }
  }
  if (target.key === "fast-jobs") {
    const assignment = `NEXT_PUBLIC_SITE_URL = ${JSON.stringify(value(env, "NEXT_PUBLIC_SITE_URL"))}`;
    if (!content.includes(assignment)) errors.push("NEXT_PUBLIC_SITE_URL runtime variable is missing");
    validateQueueFeatureFlags(content, errors);
    validateQueueConsumerBlock(content, errors, {
      queue: "flamenode-notification-wake",
      dlq: "flamenode-notification-dlq",
      retryDelay: 60,
    });
    validateCronSchedule(content, errors, ["0 * * * *"]);
  }
  if (target.key === "content-jobs") {
    validateQueueFeatureFlags(content, errors);
    validateQueueConsumerBlock(content, errors, {
      queue: "flamenode-static-rebuild-wake",
      dlq: "flamenode-static-rebuild-dlq",
      retryDelay: 60,
    });
    validateCronSchedule(content, errors, ["15 * * * *"]);
  }
  if (target.key === "sync-jobs") {
    validateQueueFeatureFlags(content, errors);
    validateQueueConsumerBlock(content, errors, {
      queue: "flamenode-youtube-sync-wake",
      dlq: "flamenode-youtube-sync-dlq",
      retryDelay: 300,
    });
    if (
      !/\[\[queues\.producers\]\][\s\S]*?queue\s*=\s*"flamenode-static-rebuild-wake"[\s\S]*?binding\s*=\s*"STATIC_REBUILD_WAKE_QUEUE"/m.test(
        content,
      )
    ) {
      errors.push(
        "sync-jobs must produce to flamenode-static-rebuild-wake for score-driven rebuilds",
      );
    }
    validateCronSchedule(content, errors, ["7 * * * *", "52 * * * *"]);
  }
  if (target.key === "web") {
    validateQueueFeatureFlags(content, errors);
    for (const queueBinding of [
      "NOTIFICATION_WAKE_QUEUE",
      "STATIC_REBUILD_WAKE_QUEUE",
      "YOUTUBE_SYNC_WAKE_QUEUE",
    ]) {
      if (!new RegExp(`^\\s*binding\\s*=\\s*"${queueBinding}"\\s*$`, "m").test(content)) {
        errors.push(`required queue producer binding ${queueBinding} is missing`);
      }
    }
    if (/\[\[queues\.consumers\]\]/m.test(content)) {
      errors.push("web Worker must not define queue consumers");
    }
  }
  if (errors.length > 0) throw new Error(`${relativePath}: ${errors.join("; ")}`);
}

function buildProductionConfig(template, target, env, commit, sourcePath) {
  let output = stripTrackedBuildSection(template);
  output = replaceRequired(
    output,
    /^(\s*database_id\s*=\s*)"[^"]*"\s*$/gm,
    (_match, prefix) => `${prefix}"${value(env, "CF_D1_DATABASE_ID")}"`,
    "D1 database_id",
    sourcePath,
  );
  output = replaceRequired(
    output,
    /^(\s*id\s*=\s*)"[^"]*"\s*$/gm,
    (_match, prefix) => `${prefix}"${value(env, "CF_KV_NAMESPACE_ID")}"`,
    "KV namespace id",
    sourcePath,
  );
  output = output.replace(/^\s*preview_id\s*=.*(?:\r?\n|$)/gm, "");
  if (target.requiresR2) {
    output = replaceRequired(
      output,
      /^(\s*bucket_name\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"${value(env, "CF_R2_BUCKET_NAME")}"`,
      "R2 bucket_name",
      sourcePath,
    );
  }
  output = injectCommitVariable(output, commit);
  output = injectAccountId(output, value(env, "CLOUDFLARE_ACCOUNT_ID"));
  if (target.key === "web") {
    output = replaceRequired(
      output,
      /^(\s*main\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../.open-next/worker.js"`,
      "OpenNext worker main",
      sourcePath,
    );
    output = replaceRequired(
      output,
      /^(\s*directory\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../.open-next/assets"`,
      "OpenNext assets directory",
      sourcePath,
    );
    output = replaceRequired(
      output,
      /^(\s*migrations_dir\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../migrations"`,
      "D1 migrations_dir",
      sourcePath,
    );
    for (const name of ["NEXT_PUBLIC_SITE_URL", "AUTH_URL", "AUTH_DISCORD_ID"]) {
      output = injectStringVariable(output, name, value(env, name));
    }
  }
  if (target.key === "fast-jobs") {
    output = replaceRequired(
      output,
      /^(\s*main\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../workers/fast-jobs/index.ts"`,
      "fast-jobs main",
      sourcePath,
    );
    output = injectStringVariable(
      output,
      "NEXT_PUBLIC_SITE_URL",
      value(env, "NEXT_PUBLIC_SITE_URL"),
    );
  }
  if (target.key === "content-jobs") {
    output = replaceRequired(
      output,
      /^(\s*main\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../workers/content-jobs/index.ts"`,
      "content-jobs main",
      sourcePath,
    );
  }
  if (target.key === "sync-jobs") {
    output = replaceRequired(
      output,
      /^(\s*main\s*=\s*)"[^"]*"\s*$/gm,
      (_match, prefix) => `${prefix}"../../workers/sync-jobs/index.ts"`,
      "sync-jobs main",
      sourcePath,
    );
  }
  // Optional Build Variables: QUEUE_* = 1 keeps wake flags across Workers Builds deploys.
  output = injectQueueFeatureFlags(output, env);
  return output;
}

export function materializeProductionConfigs({
  env = process.env,
  repoRoot = process.cwd(),
  outputDir = path.join(repoRoot, ".cloudflare", "generated"),
  commit = value(env, "WORKERS_CI_COMMIT_SHA").toLowerCase(),
} = {}) {
  if (!SHA_PATTERN.test(commit)) throw new Error("A verified production commit SHA is required.");
  fs.mkdirSync(outputDir, { recursive: true });
  const configs = {};
  for (const target of DEPLOY_TARGETS) {
    const override = value(env, target.configEnv);
    const configPath = override
      ? path.resolve(repoRoot, override)
      : path.resolve(outputDir, target.output);
    if (override) {
      if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
        throw new Error(`${target.configEnv} must point to an existing production config file.`);
      }
    } else {
      const sourcePath = path.resolve(repoRoot, target.source);
      if (!fs.existsSync(sourcePath)) throw new Error(`${target.source}: tracked template is missing.`);
      const template = fs.readFileSync(sourcePath, "utf8");
      const generated = buildProductionConfig(template, target, env, commit, target.source);
      fs.writeFileSync(configPath, generated, { encoding: "utf8", mode: 0o600 });
    }
    const content = fs.readFileSync(configPath, "utf8");
    validateProductionConfig(content, target, env, commit, path.relative(repoRoot, configPath));
    configs[target.key] = configPath;
  }
  return configs;
}

export function redactionValues(env = process.env) {
  return SENSITIVE_ENV_NAMES.map((name) => value(env, name)).filter((item) => item.length >= 4);
}

export function redactOutput(output, env = process.env) {
  let safe = String(output ?? "");
  for (const secret of redactionValues(env)) safe = safe.split(secret).join("[REDACTED]");
  return safe;
}

export function runProcess({
  executable,
  args,
  cwd = process.cwd(),
  env = process.env,
  label,
  spawn = spawnSync,
  allowOutput = true,
} = {}) {
  if (!executable || !Array.isArray(args) || !label) throw new Error("Invalid child process request.");
  const started = performance.now();
  console.log(`[${label}] start`);
  const result = spawn(executable, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  if (allowOutput) {
    const stdout = redactOutput(result.stdout, env).trim();
    const stderr = redactOutput(result.stderr, env).trim();
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  }
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ? ` (${result.error.message})` : "";
    const stderr = redactOutput(result.stderr, env).trim();
    const stdout = redactOutput(result.stdout, env).trim();
    const outputHint = stderr || stdout ? `\n${stderr || stdout}` : "";
    throw new Error(`${label} FAILED after ${elapsed}s${detail}${outputHint}`);
  }
  console.log(`[${label}] OK ${elapsed}s`);
  return result;
}

export function resolveTool(repoRoot, envName, defaultRelative, env = process.env) {
  const override = value(env, envName);
  const resolved = path.resolve(repoRoot, override || defaultRelative);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${envName || defaultRelative} executable was not found.`);
  }
  return resolved;
}

export function expectedMigrationNames(repoRoot = process.cwd()) {
  const migrationsDir = path.join(repoRoot, "migrations");
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function findSchemaRow(valueToSearch) {
  if (Array.isArray(valueToSearch)) {
    for (const item of valueToSearch) {
      const found = findSchemaRow(item);
      if (found) return found;
    }
  } else if (valueToSearch && typeof valueToSearch === "object") {
    if (Object.hasOwn(valueToSearch, "schema_version")) return valueToSearch;
    for (const item of Object.values(valueToSearch)) {
      const found = findSchemaRow(item);
      if (found) return found;
    }
  }
  return null;
}

function normalizeMigrationName(name) {
  return String(name).trim().replace(/\.sql$/i, "");
}

export function assertSchemaPreflightPayload(payload, expectedMigrations) {
  const row = findSchemaRow(payload);
  if (!row) throw new Error("Remote D1 preflight returned no schema result.");
  if (row.schema_version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error(
      `Remote D1 schema version does not match ${REQUIRED_SCHEMA_VERSION}. Run the documented migration command manually; automatic migration is disabled.`,
    );
  }
  const requiredTableCount = Number(row.required_table_count);
  if (requiredTableCount !== REQUIRED_RUNTIME_TABLE_COUNT) {
    throw new Error("Remote D1 is missing one or more required tables; deployment stopped.");
  }
  const rawNames = typeof row.migration_names === "string" ? row.migration_names.split("\u001f") : [];
  const applied = new Set(rawNames.map(normalizeMigrationName));
  const missing = expectedMigrations.filter((name) => !applied.has(normalizeMigrationName(name)));
  if (missing.length > 0) {
    throw new Error(
      `Remote D1 has unapplied migrations: ${missing.join(", ")}. Run "npx wrangler d1 migrations apply flamenode_db --remote --config <generated-web-config>" manually, then retry.`,
    );
  }
  return row;
}

export function runReadOnlySchemaPreflight({
  env = process.env,
  repoRoot = process.cwd(),
  webConfig,
  wranglerBin,
  run = runProcess,
} = {}) {
  const quotedTables = RUNTIME_CRITICAL_TABLES.map((name) => `'${name}'`).join(",");
  const sql = [
    "SELECT",
    "(SELECT version FROM flamenode_schema_meta WHERE id = 'current') AS schema_version,",
    "(SELECT COUNT(*) FROM d1_migrations) AS migration_count,",
    "(SELECT group_concat(name, char(31)) FROM (SELECT name FROM d1_migrations ORDER BY id)) AS migration_names,",
    `(SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (${quotedTables})) AS required_table_count`,
  ].join(" ");
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|PRAGMA)\b/i.test(sql)) {
    throw new Error("Internal error: D1 preflight must remain read-only.");
  }
  const result = run({
    executable: process.execPath,
    args: [
      wranglerBin,
      "d1",
      "execute",
      "flamenode_db",
      "--remote",
      "--config",
      webConfig,
      "--command",
      sql,
      "--json",
    ],
    cwd: repoRoot,
    env,
    label: "cloudflare-deploy:d1-read-only-preflight",
    allowOutput: false,
  });
  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    throw new Error("Remote D1 preflight returned malformed JSON; deployment stopped.");
  }
  return assertSchemaPreflightPayload(payload, expectedMigrationNames(repoRoot));
}

function secretNames(payload) {
  const names = new Set();
  const pending = [payload];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (typeof current.name === "string") names.add(current.name);
    pending.push(...Object.values(current));
  }
  return names;
}

export function assertRemoteSecretPayload(payload, requiredNames, service) {
  const available = secretNames(payload);
  const missing = requiredNames.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${service}: required remote Worker secret names are missing: ${missing.join(", ")}. Register them as Runtime Secrets on ${service} (Dashboard → Workers → Settings → Secrets), not only Build Secrets.`,
    );
  }
  return available;
}

export function runRemoteSecretPreflight({
  env = process.env,
  repoRoot = process.cwd(),
  configs,
  wranglerBin,
  run = runProcess,
} = {}) {
  for (const target of DEPLOY_TARGETS) {
    const required = [...REMOTE_SECRET_REQUIREMENTS[target.key]];
    const result = run({
      executable: process.execPath,
      args: [wranglerBin, "secret", "list", "--name", target.service, "--format", "json"],
      cwd: repoRoot,
      env,
      label: `cloudflare-deploy:${target.service}:secret-name-preflight`,
      allowOutput: false,
    });
    let payload;
    try {
      payload = JSON.parse(String(result.stdout ?? "").trim());
    } catch {
      throw new Error(
        `${target.service}: remote secret list returned malformed JSON. Verify CLOUDFLARE_API_TOKEN can list Worker secrets and CLOUDFLARE_ACCOUNT_ID matches the Worker account.`,
      );
    }
    const available = assertRemoteSecretPayload(payload, required, target.service);
    if (
      target.key === "fast-jobs" &&
      !available.has("DISCORD_BOT_TOKEN") &&
      !available.has("DISCORD_WEBHOOK_URL")
    ) {
      throw new Error(
        `${target.service}: required remote Worker secret names are missing: DISCORD_BOT_TOKEN or DISCORD_WEBHOOK_URL. Configure one before retrying.`,
      );
    }
  }
}

export const WORKER_UPLOAD_SIZE_WARN_BYTES = Math.floor(2.7 * 1024 * 1024);
export const WORKER_UPLOAD_SIZE_FAIL_BYTES = Math.floor(2.9 * 1024 * 1024);

const UPLOAD_UNIT_BYTES = {
  b: 1,
  kib: 1024,
  mib: 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

export function parseWranglerTotalUploadBytes(output) {
  const match = String(output ?? "").match(
    /Total Upload:\s+([\d.]+)\s+(B|KiB|MiB|GiB)\b/i,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  const multiplier = UPLOAD_UNIT_BYTES[unit];
  if (!multiplier) return null;
  return Math.round(amount * multiplier);
}

export function assertWorkerUploadSizeWithinLimit(bytes, service) {
  if (bytes == null) {
    throw new Error(`${service}: wrangler dry-run did not report Total Upload size.`);
  }
  if (bytes >= WORKER_UPLOAD_SIZE_FAIL_BYTES) {
    throw new Error(
      `${service}: Worker upload ${(bytes / (1024 * 1024)).toFixed(2)} MiB exceeds fail limit ${(WORKER_UPLOAD_SIZE_FAIL_BYTES / (1024 * 1024)).toFixed(1)} MiB.`,
    );
  }
  if (bytes >= WORKER_UPLOAD_SIZE_WARN_BYTES) {
    console.warn(
      `[cloudflare-deploy] ${service}: Worker upload ${(bytes / (1024 * 1024)).toFixed(2)} MiB exceeds warn limit ${(WORKER_UPLOAD_SIZE_WARN_BYTES / (1024 * 1024)).toFixed(1)} MiB.`,
    );
  }
}

export function runWorkerUploadSizePreflight({
  env = process.env,
  repoRoot = process.cwd(),
  configs,
  wranglerBin,
  run = runProcess,
} = {}) {
  for (const target of DEPLOY_TARGETS) {
    if (target.key === "web") continue;
    const result = run({
      executable: process.execPath,
      args: [wranglerBin, "deploy", "--dry-run", "--config", configs[target.key]],
      cwd: repoRoot,
      env,
      label: `cloudflare-deploy:${target.service}:upload-size-preflight`,
      allowOutput: false,
    });
    assertWorkerUploadSizeWithinLimit(
      parseWranglerTotalUploadBytes(result.stdout),
      target.service,
    );
  }
}
