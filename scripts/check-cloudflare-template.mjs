#!/usr/bin/env node
/** Validate the checked-in OpenNext Worker and Cron Worker templates. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ZERO_D1_ID = "00000000-0000-0000-0000-000000000000";
const ZERO_KV_ID = "00000000000000000000000000000000";
const QUEUE_FEATURE_FLAGS = [
  "QUEUE_DISPATCH_ENABLED",
  "QUEUE_CONTINUATION_ENABLED",
  "QUEUE_YOUTUBE_SYNC_ENABLED",
];
const LEGACY_CRON_PATTERNS = [
  /\*\/5\s+\*\s+\*\s+\*\s+\*/,
  /\*\/15\s+\*\s+\*\s+\*\s+\*/,
  /7,22,37,52\s+\*\s+\*\s+\*\s+\*/,
];
const TOML_SCAN_EXCLUDED_DIRECTORIES = new Set([
  ".cloudflare",
  ".git",
  ".next",
  ".open-next",
  "node_modules",
]);

const expectedWorkers = new Map([
  [
    "fast-jobs",
    {
      name: "flamenode-fast-jobs",
      d1: true,
      r2: false,
      kv: true,
      crons: ["0 * * * *"],
      queueProducers: [
        { queue: "flamenode-notification-wake", binding: "NOTIFICATION_WAKE_QUEUE" },
      ],
      queueConsumer: {
        queue: "flamenode-notification-wake",
        dlq: "flamenode-notification-dlq",
        retryDelay: 60,
      },
    },
  ],
  [
    "content-jobs",
    {
      name: "flamenode-content-jobs",
      d1: true,
      r2: true,
      kv: true,
      crons: ["15 * * * *"],
      queueProducers: [
        { queue: "flamenode-static-rebuild-wake", binding: "STATIC_REBUILD_WAKE_QUEUE" },
      ],
      queueConsumer: {
        queue: "flamenode-static-rebuild-wake",
        dlq: "flamenode-static-rebuild-dlq",
        retryDelay: 60,
      },
    },
  ],
  [
    "sync-jobs",
    {
      name: "flamenode-sync-jobs",
      d1: true,
      r2: true,
      kv: true,
      crons: ["7 * * * *", "52 * * * *"],
      queueProducers: [
        { queue: "flamenode-youtube-sync-wake", binding: "YOUTUBE_SYNC_WAKE_QUEUE" },
        { queue: "flamenode-static-rebuild-wake", binding: "STATIC_REBUILD_WAKE_QUEUE" },
      ],
      queueConsumer: {
        queue: "flamenode-youtube-sync-wake",
        dlq: "flamenode-youtube-sync-dlq",
        retryDelay: 300,
      },
    },
  ],
]);

function requirePattern(errors, text, relative, pattern, description) {
  pattern.lastIndex = 0;
  if (!pattern.test(text)) errors.push(`${relative}: ${description}`);
}

function rejectPattern(errors, text, relative, pattern, description) {
  pattern.lastIndex = 0;
  if (pattern.test(text)) errors.push(`${relative}: ${description}`);
}

function readFile(root, relative, errors) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    errors.push(`${relative}: required file is missing`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function checkPlaceholderIds(errors, text, relative) {
  for (const match of text.matchAll(/^\s*(database_id|id|preview_id)\s*=\s*"([^"]*)"\s*$/gm)) {
    const expected = match[1] === "database_id" ? ZERO_D1_ID : ZERO_KV_ID;
    if (match[2] !== expected) {
      errors.push(
        `${relative}: tracked ${match[1]} must remain the zero placeholder; production IDs are injected only into ignored temporary configs`,
      );
    }
  }
}

function trackedTomlFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && TOML_SCAN_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".toml")) files.push(fullPath);
    }
  }
  return files.sort();
}

function checkAllTrackedTomlIds(errors, root) {
  for (const filePath of trackedTomlFiles(root)) {
    const relative = path.relative(root, filePath).replaceAll("\\", "/");
    checkPlaceholderIds(errors, fs.readFileSync(filePath, "utf8"), relative);
  }
}

function checkQueueFeatureFlags(errors, text, relative) {
  for (const name of QUEUE_FEATURE_FLAGS) {
    requirePattern(
      errors,
      text,
      relative,
      new RegExp(`^\\s*${name}\\s*=\\s*"0"\\s*$`, "m"),
      `${name} must default to "0"`,
    );
  }
}

function checkQueueProducer(errors, text, relative, { queue, binding }) {
  const blockPattern = new RegExp(
    `\\[\\[queues\\.producers\\]\\][\\s\\S]*?queue\\s*=\\s*"${queue}"[\\s\\S]*?binding\\s*=\\s*"${binding}"`,
    "m",
  );
  requirePattern(errors, text, relative, blockPattern, `queue producer ${binding} -> ${queue} is required`);
}

function checkQueueConsumer(errors, text, relative, { queue, dlq, retryDelay }) {
  const blockPattern = new RegExp(
    `\\[\\[queues\\.consumers\\]\\][\\s\\S]*?queue\\s*=\\s*"${queue}"[\\s\\S]*?(?=\\n\\[\\[|$)`,
  );
  const block = text.match(blockPattern)?.[0];
  if (!block) {
    errors.push(`${relative}: queue consumer ${queue} is required`);
    return;
  }
  for (const [key, expected] of [
    ["max_batch_size", "10"],
    ["max_batch_timeout", "1"],
    ["max_retries", "3"],
    ["retry_delay", String(retryDelay)],
    ["dead_letter_queue", dlq],
    ["max_concurrency", "1"],
  ]) {
    const pattern =
      key === "dead_letter_queue"
        ? new RegExp(`^\\s*${key}\\s*=\\s*"${expected}"\\s*$`, "m")
        : new RegExp(`^\\s*${key}\\s*=\\s*${expected}\\s*$`, "m");
    if (!pattern.test(block)) {
      errors.push(`${relative}: queue consumer ${queue} must set ${key} = ${expected}`);
    }
  }
}

function checkWorkerCronSchedule(errors, text, relative, expectedCrons) {
  const declarations = [...text.matchAll(/^\s*crons\s*=\s*\[([^\]]*)\]\s*$/gm)];
  if (declarations.length !== 1) {
    errors.push(`${relative}: exactly one cron declaration is required`);
    return;
  }
  const entries = [...declarations[0][1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const residual = declarations[0][1].replace(/"[^"]+"/g, "").replace(/[\s,]/g, "");
  if (residual || entries.length !== expectedCrons.length) {
    errors.push(`${relative}: cron schedule must be ${expectedCrons.join(", ")}`);
    return;
  }
  for (const cron of expectedCrons) {
    if (!entries.includes(cron)) errors.push(`${relative}: cron expression ${cron} is required`);
  }
  for (const pattern of LEGACY_CRON_PATTERNS) {
    if (entries.some((entry) => pattern.test(entry))) {
      errors.push(`${relative}: legacy cron schedule is forbidden`);
    }
  }
}

function checkWorker(errors, root, directory, expected) {
  const relative = path.posix.join("workers", directory, "wrangler.toml");
  const text = readFile(root, relative, errors);
  requirePattern(errors, text, relative, new RegExp(`^name\\s*=\\s*"${expected.name}"\\s*$`, "m"), "wrong Worker name");
  requirePattern(errors, text, relative, /^main\s*=\s*"index\.ts"\s*$/m, "main must be index.ts");
  requirePattern(errors, text, relative, /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m, "compatibility_date is required");
  requirePattern(errors, text, relative, /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m, "nodejs_compat is required");
  if (expected.d1) requirePattern(errors, text, relative, /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m, "D1 binding DB is required");
  if (expected.r2) requirePattern(errors, text, relative, /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"R2"/m, "R2 binding R2 is required");
  if (expected.kv) requirePattern(errors, text, relative, /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"KV"/m, "KV binding KV is required");
  checkQueueFeatureFlags(errors, text, relative);
  const producers = expected.queueProducers ?? (expected.queueProducer ? [expected.queueProducer] : []);
  for (const producer of producers) {
    checkQueueProducer(errors, text, relative, producer);
  }
  checkQueueConsumer(errors, text, relative, expected.queueConsumer);
  checkWorkerCronSchedule(errors, text, relative, expected.crons);
  rejectPattern(errors, text, relative, /\b(?:token|secret|password|api_key)\s*=\s*"/i, "secret assignments must not be committed");
  rejectPattern(errors, text, relative, /pages_build_output_dir|\.vercel\/output|wrangler\s+pages/i, "legacy Pages configuration is forbidden");
}

function workerTemplateDirectories(root) {
  const workerRoot = path.join(root, "workers");
  if (!fs.existsSync(workerRoot)) return [];
  return fs
    .readdirSync(workerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(workerRoot, entry.name, "wrangler.toml")))
    .map((entry) => entry.name)
    .sort();
}

export function checkCloudflareTemplate({ root = process.cwd() } = {}) {
  const errors = [];
  const rootToml = readFile(root, "wrangler.toml", errors);
  requirePattern(errors, rootToml, "wrangler.toml", /^name\s*=\s*"flamenode-web"\s*$/m, "Worker name must be flamenode-web");
  requirePattern(errors, rootToml, "wrangler.toml", /^main\s*=\s*"\.open-next\/worker\.js"\s*$/m, "main must be .open-next/worker.js");
  const buildSectionIndex = rootToml.search(/^\[build\]\s*$/m);
  for (const key of ["main", "compatibility_date", "compatibility_flags", "workers_dev"]) {
    const keyIndex = rootToml.search(new RegExp(`^${key}\\s*=`, "m"));
    if (buildSectionIndex >= 0 && keyIndex > buildSectionIndex) {
      errors.push(`wrangler.toml: ${key} must be a root key before [build]`);
    }
  }
  requirePattern(errors, rootToml, "wrangler.toml", /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m, "compatibility_date is required");
  requirePattern(errors, rootToml, "wrangler.toml", /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m, "nodejs_compat is required");
  requirePattern(errors, rootToml, "wrangler.toml", /compatibility_flags\s*=\s*\[[^\]]*"global_fetch_strictly_public"/m, "global_fetch_strictly_public is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[assets\][\s\S]*?directory\s*=\s*"\.open-next\/assets"/m, "assets directory must be .open-next/assets");
  requirePattern(errors, rootToml, "wrangler.toml", /\[assets\][\s\S]*?binding\s*=\s*"ASSETS"/m, "assets binding ASSETS is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[assets\][\s\S]*?run_worker_first\s*=\s*false/m, "assets.run_worker_first must be false");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[services\]\][\s\S]*?binding\s*=\s*"WORKER_SELF_REFERENCE"/m, "OpenNext self-service binding is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[services\]\][\s\S]*?service\s*=\s*"flamenode-web"/m, "OpenNext self-service target must be flamenode-web");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m, "D1 binding DB is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"BUCKET"/m, "R2 binding BUCKET is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"NEXT_INC_CACHE_R2_BUCKET"/m, "OpenNext R2 incremental-cache binding is required");
  requirePattern(errors, rootToml, "wrangler.toml", /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"KV"/m, "KV binding KV is required");
  requirePattern(
    errors,
    rootToml,
    "wrangler.toml",
    /\[build\][\s\S]*?command\s*=\s*"node scripts\/workers-ci-wrangler-guard\.mjs"/m,
    "Workers CI bare wrangler deploy guard is required",
  );
  rejectPattern(errors, rootToml, "wrangler.toml", /pages_build_output_dir|\.vercel\/output|wrangler\s+pages/i, "legacy Pages configuration is forbidden");
  rejectPattern(errors, rootToml, "wrangler.toml", /^\s*crons\s*=/m, "the web Worker must not define a cron trigger");
  rejectPattern(errors, rootToml, "wrangler.toml", /\[durable_objects\]|\[\[migrations\]\]/i, "unapproved Durable Object bindings are forbidden");
  rejectPattern(errors, rootToml, "wrangler.toml", /\b(?:token|secret|password|api_key)\s*=\s*"/i, "secret assignments must not be committed");
  rejectPattern(errors, rootToml, "wrangler.toml", /FLAMENODE_LOCAL_PREVIEW/, "local preview allowance must not be tracked in the Worker template");
  checkQueueFeatureFlags(errors, rootToml, "wrangler.toml");
  checkQueueProducer(errors, rootToml, "wrangler.toml", {
    queue: "flamenode-notification-wake",
    binding: "NOTIFICATION_WAKE_QUEUE",
  });
  checkQueueProducer(errors, rootToml, "wrangler.toml", {
    queue: "flamenode-static-rebuild-wake",
    binding: "STATIC_REBUILD_WAKE_QUEUE",
  });
  checkQueueProducer(errors, rootToml, "wrangler.toml", {
    queue: "flamenode-youtube-sync-wake",
    binding: "YOUTUBE_SYNC_WAKE_QUEUE",
  });
  rejectPattern(errors, rootToml, "wrangler.toml", /\[\[queues\.consumers\]\]/m, "the web Worker must not define queue consumers");

  const directories = workerTemplateDirectories(root);
  const expectedDirectories = [...expectedWorkers.keys()].sort();
  if (directories.join(",") !== expectedDirectories.join(",")) {
    errors.push(`exactly three Cron Worker templates are required: ${expectedDirectories.join(", ")}`);
  }
  for (const [directory, expected] of expectedWorkers) checkWorker(errors, root, directory, expected);
  checkAllTrackedTomlIds(errors, root);

  const packageSource = readFile(root, "package.json", errors);
  let packageJson = {};
  try {
    packageJson = JSON.parse(packageSource);
  } catch {
    errors.push("package.json: malformed JSON");
  }
  const allDependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  if (!allDependencies["@opennextjs/cloudflare"]) errors.push("package.json: @opennextjs/cloudflare is required");
  if (allDependencies["@cloudflare/next-on-pages"]) errors.push("package.json: @cloudflare/next-on-pages must be removed");
  if (packageJson.engines?.node !== ">=22 <23") errors.push('package.json: engines.node must be ">=22 <23"');
  const scriptsSource = JSON.stringify(packageJson.scripts ?? {});
  if (Object.keys(packageJson.scripts ?? {}).some((name) => name.startsWith("pages:"))) {
    errors.push("package.json: legacy pages:* scripts must be removed");
  }
  rejectPattern(errors, scriptsSource, "package.json", /next-on-pages|wrangler\s+pages|\.vercel\/output/i, "legacy Pages build or deploy command is forbidden");

  const nvmrc = readFile(root, ".nvmrc", errors).trim();
  if (nvmrc !== "22") errors.push(".nvmrc: Node 22 is required");
  const openNext = readFile(root, "open-next.config.ts", errors);
  requirePattern(errors, openNext, "open-next.config.ts", /@opennextjs\/cloudflare/, "OpenNext Cloudflare adapter import is required");
  requirePattern(errors, openNext, "open-next.config.ts", /defineCloudflareConfig/, "defineCloudflareConfig is required");

  const nextConfigPath = path.join(root, "next.config.mjs");
  if (fs.existsSync(nextConfigPath)) {
    rejectPattern(errors, fs.readFileSync(nextConfigPath, "utf8"), "next.config.mjs", /@cloudflare\/next-on-pages|setupDevPlatform/, "legacy next-on-pages development setup is forbidden");
  }

  const idsExampleSource = readFile(root, "cloudflare/ids.example.json", errors);
  if (idsExampleSource) {
    try {
      const example = JSON.parse(idsExampleSource);
      if (example.NODE_VERSION !== "22") errors.push("cloudflare/ids.example.json: NODE_VERSION must be 22");
      if (example.SKIP_DEPENDENCY_INSTALL !== "true") {
        errors.push("cloudflare/ids.example.json: SKIP_DEPENDENCY_INSTALL must be true");
      }
      if (example.CLOUDFLARE_ACCOUNT_ID !== ZERO_KV_ID) {
        errors.push("cloudflare/ids.example.json: CLOUDFLARE_ACCOUNT_ID must remain the zero placeholder");
      }
      if (example.CF_D1_DATABASE_ID !== ZERO_D1_ID) {
        errors.push("cloudflare/ids.example.json: CF_D1_DATABASE_ID must remain the zero placeholder");
      }
      if (example.CF_KV_NAMESPACE_ID !== ZERO_KV_ID) {
        errors.push("cloudflare/ids.example.json: CF_KV_NAMESPACE_ID must remain the zero placeholder");
      }
      if (Object.hasOwn(example, "pages_project_name") || Object.hasOwn(example, "kv_preview_id")) {
        errors.push("cloudflare/ids.example.json: legacy Pages or preview-ID fields are forbidden");
      }
    } catch {
      errors.push("cloudflare/ids.example.json: malformed JSON");
    }
  }
  return errors;
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const errors = checkCloudflareTemplate();
  if (errors.length) {
    console.error("[check:cloudflare-template] FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("[check:cloudflare-template] OK (OpenNext Worker + exactly three Cron Workers; tracked IDs are placeholders)");
  }
}
