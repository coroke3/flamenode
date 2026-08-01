import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveManagedBuildOutput,
  runCloudflareBuild,
} from "./cloudflare-build.mjs";
import {
  assertPreviewArtifact,
  buildPreviewInvocation,
} from "./cloudflare-preview.mjs";
import {
  deployProduction,
  deploymentEnvironment,
} from "./cloudflare-deploy-production.mjs";
import {
  CLOUD_BUILD_VERIFY_STEPS,
  FAST_VERIFY_STEPS,
  runCloudBuildVerification,
  runFastVerification,
} from "./cloudflare-verify-fast.mjs";
import {
  RUNTIME_CRITICAL_TABLES,
  REQUIRED_SCHEMA_VERSION,
  assertCleanGitWorktree,
  assertCommitSha,
  assertRemoteSecretPayload,
  assertSchemaPreflightPayload,
  assertWorkerUploadSizeWithinLimit,
  materializeProductionConfigs,
  parseWranglerTotalUploadBytes,
  redactOutput,
  runProcess,
  runReadOnlySchemaPreflight,
  runRemoteSecretPreflight,
  verifyProductionEnvironment,
} from "./cloudflare-production.mjs";
import {
  checkOpenNextOutput,
  writeBuildManifest,
} from "./check-open-next-output.mjs";
import { runSmoke, smokeEnvironment } from "./smoke-cloudflare.mjs";
import {
  isWorkersCi,
  rejectBareWorkersCiWranglerDeploy,
} from "./cloudflare-production.mjs";

const root = path.resolve(import.meta.dirname, "..");
const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function productionEnv(overrides = {}) {
  return {
    CI: "true",
    NODE_VERSION: "22",
    SKIP_DEPENDENCY_INSTALL: "true",
    WORKERS_CI: "1",
    WORKERS_CI_BUILD_UUID: "11111111-2222-4333-8444-555555555555",
    WORKERS_CI_BRANCH: "main",
    WORKERS_CI_COMMIT_SHA: COMMIT,
    CLOUDFLARE_API_TOKEN: "cf-token-production-value",
    CLOUDFLARE_ACCOUNT_ID: "fedcba0987654321fedcba0987654321",
    CF_D1_DATABASE_ID: "12345678-1234-4234-9234-123456789abc",
    CF_KV_NAMESPACE_ID: "abcdef0123456789abcdef0123456789",
    CF_R2_BUCKET_NAME: "flamenode-production-storage",
    FLAMENODE_WEB_URL: "https://flamenode.example.com",
    FAST_JOBS_URL: "https://fast-jobs.example.workers.dev",
    CONTENT_JOBS_URL: "https://content-jobs.example.workers.dev",
    SYNC_JOBS_URL: "https://sync-jobs.example.workers.dev",
    NEXT_PUBLIC_SITE_URL: "https://flamenode.example.com",
    AUTH_URL: "https://flamenode.example.com",
    AUTH_SECRET: "auth-secret-production-value",
    AUTH_DISCORD_ID: "discord-client-production-id",
    AUTH_DISCORD_SECRET: "discord-client-production-secret",
    SPREADSHEET_IMPORT_PREVIEW_SECRET: "spreadsheet-preview-production-secret",
    WORKER_ADMIN_TOKEN: "worker-admin-production-token",
    YOUTUBE_API_KEY: "youtube-production-api-key",
    YOUTUBE_OAUTH_CLIENT_ID: "youtube-oauth-production-client",
    YOUTUBE_OAUTH_CLIENT_SECRET: "youtube-oauth-production-secret",
    YOUTUBE_OAUTH_REFRESH_TOKEN: "youtube-oauth-production-refresh",
    DISCORD_BOT_TOKEN: "discord-production-bot-token",
    ...overrides,
  };
}

/** Pin Workers Builds Node 22 so local runtime does not affect the contract. */
function verifyProduction(options = {}) {
  return verifyProductionEnvironment({
    runtimeNodeVersion: "22.13.0",
    ...options,
  });
}

function withTempDirectory(prefix, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function writeFixtureTemplates(repoRoot) {
  const queueFlags = `[vars]\nQUEUE_DISPATCH_ENABLED = "0"\nQUEUE_CONTINUATION_ENABLED = "0"\nQUEUE_YOUTUBE_SYNC_ENABLED = "0"\n`;
  const configs = {
    "wrangler.toml": `name = "flamenode-web"\nmain = ".open-next/worker.js"\n[assets]\nbinding = "ASSETS"\ndirectory = ".open-next/assets"\nrun_worker_first = false\n[[services]]\nbinding = "WORKER_SELF_REFERENCE"\nservice = "flamenode-web"\n${queueFlags}[[queues.producers]]\nqueue = "flamenode-notification-wake"\nbinding = "NOTIFICATION_WAKE_QUEUE"\n[[queues.producers]]\nqueue = "flamenode-static-rebuild-wake"\nbinding = "STATIC_REBUILD_WAKE_QUEUE"\n[[queues.producers]]\nqueue = "flamenode-youtube-sync-wake"\nbinding = "YOUTUBE_SYNC_WAKE_QUEUE"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "flamenode_db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\nmigrations_dir = "migrations"\n[[r2_buckets]]\nbinding = "BUCKET"\nbucket_name = "placeholder"\n[[r2_buckets]]\nbinding = "NEXT_INC_CACHE_R2_BUCKET"\nbucket_name = "placeholder"\n[[kv_namespaces]]\nbinding = "KV"\nid = "00000000000000000000000000000000"\npreview_id = "00000000000000000000000000000000"\n`,
    "workers/fast-jobs/wrangler.toml": `name = "flamenode-fast-jobs"\nmain = "index.ts"\n[triggers]\ncrons = ["0 * * * *"]\n${queueFlags}[[queues.producers]]\nqueue = "flamenode-notification-wake"\nbinding = "NOTIFICATION_WAKE_QUEUE"\n[[queues.consumers]]\nqueue = "flamenode-notification-wake"\nmax_batch_size = 10\nmax_batch_timeout = 1\nmax_retries = 3\nretry_delay = 60\ndead_letter_queue = "flamenode-notification-dlq"\nmax_concurrency = 1\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "flamenode_db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n[[kv_namespaces]]\nbinding = "KV"\nid = "00000000000000000000000000000000"\n`,
    "workers/content-jobs/wrangler.toml": `name = "flamenode-content-jobs"\nmain = "index.ts"\n[triggers]\ncrons = ["15 * * * *"]\n${queueFlags}[[queues.producers]]\nqueue = "flamenode-static-rebuild-wake"\nbinding = "STATIC_REBUILD_WAKE_QUEUE"\n[[queues.consumers]]\nqueue = "flamenode-static-rebuild-wake"\nmax_batch_size = 10\nmax_batch_timeout = 1\nmax_retries = 3\nretry_delay = 60\ndead_letter_queue = "flamenode-static-rebuild-dlq"\nmax_concurrency = 1\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "flamenode_db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n[[r2_buckets]]\nbinding = "R2"\nbucket_name = "placeholder"\n[[kv_namespaces]]\nbinding = "KV"\nid = "00000000000000000000000000000000"\n`,
    "workers/sync-jobs/wrangler.toml": `name = "flamenode-sync-jobs"\nmain = "index.ts"\n[triggers]\ncrons = ["7 * * * *", "52 * * * *"]\n[vars]\nYOUTUBE_DAILY_QUOTA_LIMIT = "10000"\nQUEUE_DISPATCH_ENABLED = "0"\nQUEUE_CONTINUATION_ENABLED = "0"\nQUEUE_YOUTUBE_SYNC_ENABLED = "0"\nGA4_SYNC_ENABLED = "0"\n[[queues.producers]]\nqueue = "flamenode-youtube-sync-wake"\nbinding = "YOUTUBE_SYNC_WAKE_QUEUE"\n[[queues.producers]]\nqueue = "flamenode-static-rebuild-wake"\nbinding = "STATIC_REBUILD_WAKE_QUEUE"\n[[queues.consumers]]\nqueue = "flamenode-youtube-sync-wake"\nmax_batch_size = 10\nmax_batch_timeout = 1\nmax_retries = 3\nretry_delay = 300\ndead_letter_queue = "flamenode-youtube-sync-dlq"\nmax_concurrency = 1\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "flamenode_db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n[[r2_buckets]]\nbinding = "R2"\nbucket_name = "placeholder"\n[[kv_namespaces]]\nbinding = "KV"\nid = "00000000000000000000000000000000"\n`,
  };
  for (const [relative, content] of Object.entries(configs)) {
    const filePath = path.join(repoRoot, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

test("package.json build invokes Next.js directly and cannot re-enter the Cloudflare build", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts.build, /next\s+build/);
  assert.doesNotMatch(pkg.scripts.build, /cf:|cloudflare|workers-ci/i);
});

test("OpenNext invokes Next.js directly and loads routes on demand", () => {
  const config = fs.readFileSync(path.join(root, "open-next.config.ts"), "utf8");
  assert.match(config, /buildCommand:\s*["']node node_modules\/next\/dist\/bin\/next build["']/);
  assert.doesNotMatch(config, /buildCommand:\s*["'](?:npm|pnpm|yarn).*build/);
  assert.match(config, /routePreloadingBehavior:\s*["']none["']/);
  assert.doesNotMatch(config, /routePreloadingBehavior:\s*["']withWaitUntil["']/);
  assert.doesNotMatch(config, /routePreloadingBehavior:\s*["']onStart["']/);
  assert.doesNotMatch(config, /routePreloadingBehavior:\s*["']onWarmerEvent["']/);
});

test("bare wrangler deploy of tracked template is blocked in Workers CI", () => {
  assert.ok(isWorkersCi({ WORKERS_CI: "1" }));
  assert.throws(
    () => rejectBareWorkersCiWranglerDeploy({ WORKERS_CI: "1" }),
    /cf:deploy-production/,
  );
  assert.doesNotThrow(() => rejectBareWorkersCiWranglerDeploy({}));
});

test("tracked Wrangler build guard loads locally and fails closed in Workers CI", () => {
  const guard = path.join(root, "scripts", "workers-ci-wrangler-guard.mjs");
  const local = spawnSync(process.execPath, [guard], {
    env: { ...process.env, WORKERS_CI: "" },
    encoding: "utf8",
  });
  assert.equal(local.status, 0, local.stderr);

  const workersCi = spawnSync(process.execPath, [guard], {
    env: { ...process.env, WORKERS_CI: "1" },
    encoding: "utf8",
  });
  assert.equal(workersCi.status, 1);
  assert.match(workersCi.stderr, /Bare wrangler deploy.*forbidden/);
  assert.doesNotMatch(workersCi.stderr, /ReferenceError/);
});

test("generated production configs omit tracked wrangler build guard", () =>
  withTempDirectory("flamenode-production-config-build-guard-", (repoRoot) => {
    writeFixtureTemplates(repoRoot);
    const webTemplate = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "wrangler.toml"),
      `${webTemplate.trimEnd()}\n\n[build]\ncommand = "node scripts/workers-ci-wrangler-guard.mjs"\n`,
      "utf8",
    );
    const configs = materializeProductionConfigs({
      env: productionEnv(),
      repoRoot,
      commit: COMMIT,
    });
    const web = fs.readFileSync(configs.web, "utf8");
    assert.doesNotMatch(web, /\[build\]/);
  }));

test("GitHub Actions has no automatic trigger or production deployment workflow", () => {
  const workflowRoot = path.join(root, ".github", "workflows");
  const files = fs.existsSync(workflowRoot)
    ? fs.readdirSync(workflowRoot).filter((name) => /\.ya?ml$/i.test(name))
    : [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(workflowRoot, name), "utf8");
    assert.doesNotMatch(source, /^\s{2}(?:push|pull_request|schedule):/m);
    assert.doesNotMatch(source, /wrangler\s+(?:deploy|pages)|cloudflare-deploy-production|d1\s+migrations\s+apply/i);
  }
});

test("commit SHA requires WORKERS_CI_COMMIT_SHA, 40 hex, and exact git HEAD", () => {
  assert.throws(
    () => assertCommitSha({ GITHUB_SHA: COMMIT }, root, () => `${COMMIT}\n`),
    /WORKERS_CI_COMMIT_SHA is required/,
  );
  assert.throws(
    () => assertCommitSha({ WORKERS_CI_COMMIT_SHA: "a".repeat(39) }, root, () => `${COMMIT}\n`),
    /40 hexadecimal/,
  );
  assert.throws(
    () => assertCommitSha({ WORKERS_CI_COMMIT_SHA: COMMIT }, root, () => `${"f".repeat(40)}\n`),
    /does not match git HEAD/,
  );
  assert.equal(
    assertCommitSha({ WORKERS_CI_COMMIT_SHA: COMMIT.toUpperCase() }, root, () => `${COMMIT}\n`),
    COMMIT,
  );
});

test("production requires a clean Workers Builds main-branch checkout", () => {
  assert.doesNotThrow(() => assertCleanGitWorktree(root, () => ""));
  assert.throws(
    () => assertCleanGitWorktree(root, () => " M src/app.ts\n"),
    /worktree must be clean/,
  );
  for (const overrides of [
    { CI: "1" },
    { WORKERS_CI: "0" },
    { WORKERS_CI_BRANCH: "preview" },
    { WORKERS_CI_BUILD_UUID: "not-a-uuid" },
  ]) {
    assert.throws(
      () =>
        verifyProduction({
          env: productionEnv(overrides),
          requireGitHead: false,
        }),
      /Production environment verification failed/,
    );
  }
});

test("production rejects path URLs and invalid or missing Workers Builds Node settings", () => {
  for (const overrides of [
    { FLAMENODE_WEB_URL: "https://flamenode.example.com/base" },
    { NEXT_PUBLIC_SITE_URL: "https://flamenode.example.com/base" },
    { AUTH_URL: "https://flamenode.example.com/base" },
    { NODE_VERSION: "20" },
    { NODE_VERSION: "" },
    { SKIP_DEPENDENCY_INSTALL: "false" },
    { SKIP_DEPENDENCY_INSTALL: "" },
  ]) {
    assert.throws(
      () => verifyProduction({ env: productionEnv(overrides), requireGitHead: false }),
      /Production environment verification failed/,
    );
  }
});

test("production environment fails closed without required names and never echoes secret values", () => {
  const secret = "DO_NOT_ECHO_THIS_SECRET_VALUE";
  let error;
  try {
    verifyProduction({
      env: productionEnv({ AUTH_SECRET: secret, AUTH_DISCORD_ID: "" }),
      requireGitHead: false,
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(error.message, /AUTH_DISCORD_ID is required/);
  assert.doesNotMatch(error.message, new RegExp(secret));
  assert.throws(
    () => verifyProduction({ env: productionEnv({ CF_D1_DATABASE_ID: "placeholder" }), requireGitHead: false }),
    /CF_D1_DATABASE_ID/,
  );
  assert.throws(
    () => verifyProduction({ env: productionEnv({ FLAMENODE_LOCAL_PREVIEW: "1" }), requireGitHead: false }),
    /FLAMENODE_LOCAL_PREVIEW is local-only/,
  );
  const buildOnlyEnv = productionEnv();
  for (const name of [
    "AUTH_SECRET",
    "AUTH_DISCORD_SECRET",
    "SPREADSHEET_IMPORT_PREVIEW_SECRET",
    "YOUTUBE_API_KEY",
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REFRESH_TOKEN",
    "DISCORD_BOT_TOKEN",
  ]) {
    delete buildOnlyEnv[name];
  }
  assert.doesNotThrow(() =>
    verifyProduction({ env: buildOnlyEnv, requireGitHead: false }),
  );
});

test("local preview pins port, commit SHA, and local-only allowance without a shell", () => {
  const invocation = buildPreviewInvocation({
    env: { FLAMENODE_PREVIEW_PORT: "3000" },
    repoRoot: root,
    resolveCommit: () => COMMIT,
    validateArtifact: () => {},
  });
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args.slice(1), [
    "dev",
    "--config",
    "wrangler.toml",
    "--port",
    "3000",
    "--var",
    "FLAMENODE_LOCAL_PREVIEW:1",
    "--var",
    `BUILD_COMMIT_SHA:${COMMIT}`,
  ]);
  assert.throws(
    () =>
      buildPreviewInvocation({
        env: { FLAMENODE_PREVIEW_PORT: "0" },
        repoRoot: root,
        resolveCommit: () => COMMIT,
        validateArtifact: () => {},
      }),
    /FLAMENODE_PREVIEW_PORT/,
  );
});

test("local preview rejects stale, invalid, or incomplete OpenNext artifacts", () => {
  const manifest = JSON.stringify({ formatVersion: 1, commit: COMMIT });
  assert.doesNotThrow(() =>
    assertPreviewArtifact({
      repoRoot: root,
      commit: COMMIT,
      readFile: () => manifest,
      exists: () => true,
      validateOutput: () => {},
    }),
  );
  assert.throws(
    () =>
      assertPreviewArtifact({
        repoRoot: root,
        commit: COMMIT,
        readFile: () => JSON.stringify({ formatVersion: 1, commit: "f".repeat(40) }),
        exists: () => true,
      }),
    /does not match git HEAD/,
  );
  assert.throws(
    () =>
      assertPreviewArtifact({
        repoRoot: root,
        commit: COMMIT,
        readFile: () => "not json",
        exists: () => true,
      }),
    /manifest is missing or invalid/,
  );
  assert.throws(
    () =>
      assertPreviewArtifact({
        repoRoot: root,
        commit: COMMIT,
        readFile: () => manifest,
        exists: () => false,
      }),
    /worker artifact is missing/,
  );
  let validated = false;
  assertPreviewArtifact({
    repoRoot: root,
    commit: COMMIT,
    env: { AUTH_SECRET: "local-secret-value" },
    readFile: () => manifest,
    exists: () => true,
    validateOutput: ({ env, outputRoot, commit }) => {
      validated = true;
      assert.equal(env.WORKERS_CI_COMMIT_SHA, COMMIT);
      assert.equal(outputRoot, path.join(root, ".open-next"));
      assert.equal(commit, COMMIT);
    },
  });
  assert.equal(validated, true);
  assert.throws(
    () =>
      assertPreviewArtifact({
        repoRoot: root,
        commit: COMMIT,
        readFile: () => manifest,
        exists: () => true,
        validateOutput: () => {
          throw new Error("tampered artifact");
        },
      }),
    /tampered artifact/,
  );
});

test("tracked placeholder configs produce four private production configs without preview IDs", () =>
  withTempDirectory("flamenode-production-config-", (repoRoot) => {
    writeFixtureTemplates(repoRoot);
    const env = productionEnv();
    const configs = materializeProductionConfigs({ env, repoRoot, commit: COMMIT });
    assert.deepEqual(Object.keys(configs), ["web", "fast-jobs", "content-jobs", "sync-jobs"]);
    for (const configPath of Object.values(configs)) {
      assert.match(configPath.replaceAll("\\", "/"), /\.cloudflare\/generated\//);
      const source = fs.readFileSync(configPath, "utf8");
      assert.match(source, new RegExp(COMMIT));
      assert.match(source, new RegExp(`account_id = "${env.CLOUDFLARE_ACCOUNT_ID}"`));
      assert.match(source, new RegExp(env.CF_D1_DATABASE_ID));
      assert.match(source, new RegExp(env.CF_KV_NAMESPACE_ID));
      assert.doesNotMatch(source, /preview_id|00000000-0000-0000-0000-000000000000/);
    }
    const web = fs.readFileSync(configs.web, "utf8");
    assert.match(web, /NEXT_PUBLIC_SITE_URL = "https:\/\/flamenode\.example\.com"/);
    assert.match(web, /AUTH_URL = "https:\/\/flamenode\.example\.com"/);
    assert.match(web, /AUTH_DISCORD_ID = "discord-client-production-id"/);
    assert.match(web, /main = "\.\.\/\.\.\/\.open-next\/worker\.js"/);
    assert.match(web, /directory = "\.\.\/\.\.\/\.open-next\/assets"/);
    assert.match(web, /migrations_dir = "\.\.\/\.\.\/migrations"/);
    assert.doesNotMatch(web, new RegExp(env.AUTH_SECRET));
    const fast = fs.readFileSync(configs["fast-jobs"], "utf8");
    assert.match(fast, /NEXT_PUBLIC_SITE_URL = "https:\/\/flamenode\.example\.com"/);
    assert.match(fast, /main = "\.\.\/\.\.\/workers\/fast-jobs\/index\.ts"/);
  }));

test("fast verification runs the bounded npm script list in order and stops on the first failure", () => {
  const calls = [];
  const completed = runFastVerification({
    env: productionEnv(),
    npmInvocation: { executable: process.execPath, argsPrefix: ["npm-cli.js"] },
    run: ({ executable, args, label }) => calls.push({ executable, args, label }),
  });
  assert.deepEqual(completed, [...FAST_VERIFY_STEPS]);
  assert.deepEqual(calls.map((call) => call.args), FAST_VERIFY_STEPS.map((name) => ["npm-cli.js", "run", name]));
  assert.ok(calls.every((call) => call.executable === process.execPath));

  const failed = [];
  assert.throws(() =>
    runFastVerification({
      env: productionEnv(),
      npmInvocation: { executable: process.execPath, argsPrefix: ["npm-cli.js"] },
      run: ({ args }) => {
        failed.push(args[2]);
        if (args[2] === "test:critical") throw new Error("fixture failure");
      },
    }),
  );
  assert.deepEqual(failed, ["typecheck", "lint", "test:critical"]);
});

test("cloud build verification keeps only deploy-contract checks", () => {
  const calls = [];
  const completed = runCloudBuildVerification({
    env: productionEnv(),
    npmInvocation: { executable: process.execPath, argsPrefix: ["npm-cli.js"] },
    run: ({ executable, args, label }) => calls.push({ executable, args, label }),
  });
  assert.deepEqual(completed, [...CLOUD_BUILD_VERIFY_STEPS]);
  assert.deepEqual(
    calls.map((call) => call.args),
    CLOUD_BUILD_VERIFY_STEPS.map((name) => ["npm-cli.js", "run", name]),
  );
  assert.ok(!CLOUD_BUILD_VERIFY_STEPS.includes("typecheck"));
  assert.ok(!CLOUD_BUILD_VERIFY_STEPS.includes("lint"));
  assert.ok(!CLOUD_BUILD_VERIFY_STEPS.includes("test:critical"));
  assert.ok(!CLOUD_BUILD_VERIFY_STEPS.includes("test:workers"));
});

test("child processes use argv with shell disabled and redact IDs/secrets", () => {
  const env = productionEnv();
  let observed;
  const fakeSpawn = (executable, args, options) => {
    observed = { executable, args, options };
    return { status: 0, stdout: `${env.AUTH_SECRET} ${env.CF_D1_DATABASE_ID}`, stderr: "" };
  };
  const originalLog = console.log;
  const logs = [];
  console.log = (...items) => logs.push(items.join(" "));
  try {
    runProcess({ executable: process.execPath, args: ["fake.mjs", "deploy"], env, label: "fixture", spawn: fakeSpawn });
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(observed.args, ["fake.mjs", "deploy"]);
  assert.equal(observed.options.shell, false);
  assert.doesNotMatch(logs.join("\n"), new RegExp(env.AUTH_SECRET));
  assert.doesNotMatch(logs.join("\n"), new RegExp(env.CF_D1_DATABASE_ID));
  assert.match(redactOutput(`${env.AUTH_SECRET}`, env), /\[REDACTED\]/);
});

test("OpenNext output requires on-demand routes, worker, assets, matching manifest, no Pages output, and no secret value", () =>
  withTempDirectory("flamenode-open-next-output-", (repoRoot) => {
    const outputRoot = path.join(repoRoot, ".open-next");
    fs.mkdirSync(path.join(outputRoot, "assets"), { recursive: true });
    const serverConfigPath = path.join(
      outputRoot,
      "server-functions",
      "default",
      "open-next.config.mjs",
    );
    fs.mkdirSync(path.dirname(serverConfigPath), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "worker.js"), "export default {};\n", "utf8");
    fs.writeFileSync(path.join(outputRoot, "assets", "app.js"), "console.log('asset');\n", "utf8");
    fs.writeFileSync(
      serverConfigPath,
      'export default { default: { routePreloadingBehavior: "none" } };\n',
      "utf8",
    );
    writeBuildManifest({ outputRoot, commit: COMMIT });
    const env = productionEnv();
    assert.doesNotThrow(() => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }));

    fs.writeFileSync(
      serverConfigPath,
      'export default { default: { routePreloadingBehavior: "withWaitUntil" } };\n',
      "utf8",
    );
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      /on-demand route loading/,
    );
    fs.writeFileSync(
      serverConfigPath,
      'export default { default: { routePreloadingBehavior: "onStart" } };\n',
      "utf8",
    );
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      /on-demand route loading/,
    );
    fs.writeFileSync(
      serverConfigPath,
      'export default { default: { routePreloadingBehavior: "onWarmerEvent" } };\n',
      "utf8",
    );
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      /on-demand route loading/,
    );
    fs.writeFileSync(
      serverConfigPath,
      'export default { default: { routePreloadingBehavior: "none" } };\n',
      "utf8",
    );

    fs.writeFileSync(path.join(outputRoot, "assets", "leak.txt"), env.AUTH_SECRET, "utf8");
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      (error) => error.message.includes("AUTH_SECRET") && !error.message.includes(env.AUTH_SECRET),
    );
    fs.rmSync(path.join(outputRoot, "assets", "leak.txt"));
    const localOnlySecret = "local-dev-secret-that-must-not-be-bundled";
    fs.writeFileSync(path.join(repoRoot, ".dev.vars"), `AUTH_SECRET="${localOnlySecret}"\n`, "utf8");
    fs.writeFileSync(path.join(outputRoot, "assets", "local-leak.txt"), localOnlySecret, "utf8");
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      (error) => error.message.includes(".dev.vars:AUTH_SECRET") && !error.message.includes(localOnlySecret),
    );
    fs.rmSync(path.join(outputRoot, "assets", "local-leak.txt"));
    fs.mkdirSync(path.join(repoRoot, ".vercel", "output"), { recursive: true });
    assert.throws(
      () => checkOpenNextOutput({ env, repoRoot, outputRoot, commit: COMMIT }),
      /legacy Pages output/,
    );
  }));

test("Cloudflare build invokes OpenNext build exactly once and checks the resulting manifest", () =>
  withTempDirectory("flamenode-cloudflare-build-", (repoRoot) => {
    const fakeCli = path.join(repoRoot, "fake-opennext.mjs");
    fs.writeFileSync(fakeCli, "// fixture\n", "utf8");
    const calls = [];
    let checked = false;
    runCloudflareBuild({
      env: productionEnv({ CLOUDFLARE_OPENNEXT_BIN: fakeCli }),
      repoRoot,
      verifyCommit: () => COMMIT,
      run: (request) => calls.push(request),
      check: ({ outputRoot, commit }) => {
        checked = true;
        assert.equal(commit, COMMIT);
        assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, "flamenode-build-manifest.json"))).commit, COMMIT);
      },
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [fakeCli, "build"]);
    assert.equal(checked, true);
  }));

test("Cloudflare build output is fixed inside the repo and rejects overrides or symlinks", () =>
  withTempDirectory("flamenode-cloudflare-output-path-", (repoRoot) => {
    assert.equal(
      resolveManagedBuildOutput({ env: {}, repoRoot }),
      path.join(repoRoot, ".open-next"),
    );
    for (const value of [repoRoot, path.dirname(repoRoot), "C:\\", "../outside"]) {
      assert.throws(
        () =>
          resolveManagedBuildOutput({
            env: { OPEN_NEXT_OUTPUT_DIR: value },
            repoRoot,
          }),
        /OPEN_NEXT_OUTPUT_DIR is not supported/,
      );
    }
    assert.throws(
      () =>
        resolveManagedBuildOutput({
          env: {},
          repoRoot,
          exists: () => true,
          lstat: () => ({ isSymbolicLink: () => true }),
        }),
      /symlinked OpenNext output/,
    );
  }));

test("D1 production preflight is SELECT-only and requires schema/tables/all local migrations", () =>
  withTempDirectory("flamenode-d1-preflight-", (repoRoot) => {
    fs.mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "migrations", "0000_base.sql"), "SELECT 1;", "utf8");
    fs.writeFileSync(path.join(repoRoot, "migrations", "0001_next.sql"), "SELECT 1;", "utf8");
    let request;
    const row = {
      schema_version: REQUIRED_SCHEMA_VERSION,
      migration_count: 2,
      migration_names: "0000_base.sql\u001f0001_next.sql",
      required_table_count: RUNTIME_CRITICAL_TABLES.length,
    };
    runReadOnlySchemaPreflight({
      env: productionEnv(),
      repoRoot,
      webConfig: path.join(repoRoot, "web.toml"),
      wranglerBin: path.join(repoRoot, "wrangler.js"),
      run: (input) => {
        request = input;
        return { status: 0, stdout: JSON.stringify([{ success: true, results: [row] }]), stderr: "" };
      },
    });
    assert.deepEqual(request.args.slice(1, 4), ["d1", "execute", "flamenode_db"]);
    const sql = request.args[request.args.indexOf("--command") + 1];
    assert.match(sql, /^SELECT\b/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
    assert.ok(!request.args.includes("apply"));
    assert.throws(
      () => assertSchemaPreflightPayload({ results: [{ ...row, migration_names: "0000_base.sql" }] }, ["0000_base.sql", "0001_next.sql"]),
      /unapplied migrations: 0001_next\.sql/,
    );
    assert.throws(
      () =>
        assertSchemaPreflightPayload(
          { results: [{ ...row, required_table_count: RUNTIME_CRITICAL_TABLES.length - 1 }] },
          ["0000_base.sql", "0001_next.sql"],
        ),
      /missing one or more required tables/,
    );
  }));

test("remote Worker secret preflight checks names only and never accepts a missing required secret", () => {
  const configs = {
    web: "web.toml",
    "fast-jobs": "fast.toml",
    "content-jobs": "content.toml",
    "sync-jobs": "sync.toml",
  };
  const env = productionEnv();
  const byService = {
    "flamenode-web": ["AUTH_SECRET", "AUTH_DISCORD_SECRET", "SPREADSHEET_IMPORT_PREVIEW_SECRET", "WORKER_ADMIN_TOKEN"],
    "flamenode-fast-jobs": ["DISCORD_BOT_TOKEN"],
    "flamenode-content-jobs": ["WORKER_ADMIN_TOKEN"],
    "flamenode-sync-jobs": ["YOUTUBE_API_KEY", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_OAUTH_REFRESH_TOKEN"],
  };
  const requests = [];
  runRemoteSecretPreflight({
    env,
    repoRoot: root,
    configs,
    wranglerBin: "wrangler.mjs",
    run: (request) => {
      requests.push(request);
      const service = request.args[request.args.indexOf("--name") + 1];
      return { stdout: JSON.stringify(byService[service].map((name) => ({ name, type: "secret_text" }))) };
    },
  });
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.allowOutput === false));
  assert.ok(requests.every((request) => request.args.includes("list") && !request.args.includes("put")));
  assert.ok(requests.every((request) => request.args.includes("--name")));
  assert.throws(
    () => assertRemoteSecretPayload([{ name: "AUTH_SECRET" }], ["AUTH_SECRET", "WORKER_ADMIN_TOKEN"], "flamenode-web"),
    /WORKER_ADMIN_TOKEN/,
  );
  assert.throws(
    () =>
      runRemoteSecretPreflight({
        env: productionEnv(),
        repoRoot: root,
        configs,
        wranglerBin: "wrangler.mjs",
        run: (request) => {
          const service = request.args[request.args.indexOf("--name") + 1];
          const names = service === "flamenode-fast-jobs" ? [] : byService[service];
          return { stdout: JSON.stringify(names.map((name) => ({ name }))) };
        },
      }),
    /DISCORD_BOT_TOKEN or DISCORD_WEBHOOK_URL/,
  );
});

test("wrangler dry-run upload size parser enforces warn and fail thresholds", () => {
  assert.equal(
    parseWranglerTotalUploadBytes("Total Upload: 76.81 KiB / gzip: 18.92 KiB"),
    Math.round(76.81 * 1024),
  );
  assert.throws(
    () => assertWorkerUploadSizeWithinLimit(3 * 1024 * 1024, "flamenode-fast-jobs"),
    /exceeds fail limit/,
  );
  assert.doesNotThrow(() =>
    assertWorkerUploadSizeWithinLimit(100 * 1024, "flamenode-fast-jobs"),
  );
});

test("production deploy order is web, fast, content, sync and failure stops every later target", () =>
  withTempDirectory("flamenode-deploy-order-", (repoRoot) => {
    const fakeOpenNext = path.join(repoRoot, "opennext.mjs");
    const fakeWrangler = path.join(repoRoot, "wrangler.mjs");
    fs.writeFileSync(fakeOpenNext, "// fixture\n");
    fs.writeFileSync(fakeWrangler, "// fixture\n");
    const env = productionEnv({
      CLOUDFLARE_OPENNEXT_BIN: fakeOpenNext,
      CLOUDFLARE_WRANGLER_BIN: fakeWrangler,
    });
    const configs = {
      web: "web.toml",
      "fast-jobs": "fast.toml",
      "content-jobs": "content.toml",
      "sync-jobs": "sync.toml",
    };
    const labels = [];
    const common = {
      env,
      repoRoot,
      verify: () => ({ commit: COMMIT }),
      prepareConfigs: () => configs,
      checkOutput: () => undefined,
      secretPreflight: () => labels.push("secrets"),
      uploadSizePreflight: () => labels.push("upload-sizes"),
      schemaPreflight: () => labels.push("schema"),
    };
    deployProduction({ ...common, run: ({ label }) => labels.push(label) });
    assert.deepEqual(labels, [
      "secrets",
      "upload-sizes",
      "schema",
      "cloudflare-deploy:flamenode-web",
      "cloudflare-deploy:flamenode-fast-jobs",
      "cloudflare-deploy:flamenode-content-jobs",
      "cloudflare-deploy:flamenode-sync-jobs",
    ]);

    labels.length = 0;
    assert.throws(() =>
      deployProduction({
        ...common,
        run: ({ label }) => {
          labels.push(label);
          if (label === "cloudflare-deploy:flamenode-content-jobs") throw new Error("fixture failure");
        },
      }),
    );
    assert.ok(!labels.includes("cloudflare-deploy:flamenode-sync-jobs"));
  }));

test("Workers Builds identity variables are limited to the web deployment", () => {
  const env = productionEnv({
    WRANGLER_CI_OVERRIDE_NAME: "flamenode-web",
    WRANGLER_CI_MATCH_TAG: "workers-builds-web-tag",
  });
  const webEnv = deploymentEnvironment(env, {
    service: "flamenode-web",
    preserveWorkersBuildName: true,
  });
  assert.equal(webEnv.WRANGLER_CI_OVERRIDE_NAME, "flamenode-web");
  assert.equal(webEnv.WRANGLER_CI_MATCH_TAG, "workers-builds-web-tag");
  for (const service of [
    "flamenode-fast-jobs",
    "flamenode-content-jobs",
    "flamenode-sync-jobs",
  ]) {
    const cronEnv = deploymentEnvironment(env, { service });
    assert.equal(cronEnv.WRANGLER_CI_OVERRIDE_NAME, undefined);
    assert.equal(cronEnv.WRANGLER_CI_MATCH_TAG, undefined);
  }
  assert.throws(
    () =>
      deploymentEnvironment(
        { ...env, WRANGLER_CI_OVERRIDE_NAME: "unexpected-worker" },
        { service: "flamenode-web", preserveWorkersBuildName: true },
      ),
    /must be flamenode-web/,
  );
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function smokeFetch(commit, { mismatchService, staleCommitResponses = {} } = {}) {
  const staleRemaining = new Map(Object.entries(staleCommitResponses));
  const responseCommit = (service) => {
    if (service === mismatchService) return "f".repeat(40);
    const remaining = staleRemaining.get(service) ?? 0;
    if (remaining > 0) {
      staleRemaining.set(service, remaining - 1);
      return "e".repeat(40);
    }
    return commit;
  };
  return async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "flamenode.example.com" && url.pathname === "/" && method === "GET") {
      return new Response(
        '<script src="/_next/static/app.js"></script><section aria-labelledby="sec-latest"><h2 id="sec-latest">新着アップロード</h2><div class="fn-shelf"></div></section>',
        { status: 200 },
      );
    }
    if (url.hostname === "flamenode.example.com" && url.pathname === "/list" && method === "GET") {
      return new Response(
        '<h1 class="fn-page-title">作品一覧</h1><p>0<!-- --> works</p><form class="fn-list-toolbar"></form><div class="fn-empty"></div>',
        { status: 200 },
      );
    }
    if (url.pathname === "/_next/static/app.js") return new Response("asset", { status: 200 });
    if (url.pathname === "/api/admin/import/legacy" && method === "POST") {
      assert.equal(init.headers?.Origin, "https://flamenode.example.com");
      return new Response(null, { status: 401 });
    }
    if (url.pathname === "/api/health" && method === "GET") {
      return jsonResponse({
        ok: true,
        service: "flamenode-web",
        commit: responseCommit("flamenode-web"),
        runtime: "cloudflare-worker",
      });
    }
    if (url.pathname === "/api/health" && method === "POST") return new Response(null, { status: 405 });
    if (url.pathname === "/api/auth/callback/discord") return new Response(null, { status: 302 });
    if (url.pathname === "/health") {
      const service = url.hostname.startsWith("fast-")
        ? "flamenode-fast-jobs"
        : url.hostname.startsWith("content-")
          ? "flamenode-content-jobs"
          : "flamenode-sync-jobs";
      return jsonResponse({ ok: true, service, commit: responseCommit(service) });
    }
    if (["/rebuild", "/process-queue"].includes(url.pathname)) return new Response(null, { status: 401 });
    if (url.pathname === "/api/health/deep") {
      if (!init.headers?.Authorization) return new Response(null, { status: 401 });
      assert.equal(init.headers.Authorization, `Bearer ${productionEnv().WORKER_ADMIN_TOKEN}`);
      return jsonResponse({
        ok: true,
        service: "flamenode-web",
        commit: responseCommit("flamenode-web-deep"),
        checks: {
          d1: "ok",
          kv: "ok",
          r2: "ok",
          schema: "ok",
          queues: "ok",
          static_artifacts: "ok",
        },
      });
    }
    if (url.pathname === "/api/videos") {
      return jsonResponse({ items: [], total: 0, page: 1, limit: 5 });
    }
    if (url.pathname.startsWith("/__flamenode-smoke-missing-")) return new Response(null, { status: 404 });
    throw new Error(`unexpected fixture request ${method} ${url.pathname}`);
  };
}

test("smoke requires every URL and verifies web/cron SHA, admin rejection, deep reads, DTO, 404, and method", async () => {
  const env = productionEnv();
  assert.throws(
    () => smokeEnvironment({ env: { ...env, SYNC_JOBS_URL: "" }, expectedCommit: COMMIT }),
    /SYNC_JOBS_URL is required/,
  );
  for (const name of ["FLAMENODE_WEB_URL", "FAST_JOBS_URL", "CONTENT_JOBS_URL", "SYNC_JOBS_URL"]) {
    assert.throws(
      () => smokeEnvironment({ env: { ...env, [name]: `${env[name]}/base` }, expectedCommit: COMMIT }),
      new RegExp(`${name} must be a valid HTTPS URL`),
    );
  }
  await assert.doesNotReject(() =>
    runSmoke({
      env,
      expectedCommit: COMMIT,
      fetchImpl: smokeFetch(COMMIT),
      requestOptions: { attempts: 1, retryDelayMs: 0 },
    }));
  await assert.rejects(
    () => runSmoke({
      env,
      expectedCommit: COMMIT,
      fetchImpl: smokeFetch(COMMIT, { mismatchService: "flamenode-sync-jobs" }),
      requestOptions: { attempts: 1, retryDelayMs: 0 },
    }),
    /flamenode-sync-jobs health: invalid payload or commit mismatch/,
  );
});

test("smoke waits for stale 200 health responses until every deployment commit converges", async () => {
  const env = productionEnv();
  await assert.doesNotReject(() =>
    runSmoke({
      env,
      expectedCommit: COMMIT,
      fetchImpl: smokeFetch(COMMIT, {
        staleCommitResponses: {
          "flamenode-web": 1,
          "flamenode-fast-jobs": 1,
          "flamenode-content-jobs": 1,
          "flamenode-sync-jobs": 1,
          "flamenode-web-deep": 1,
        },
      }),
      requestOptions: { attempts: 2, retryDelayMs: 0 },
    }),
  );
});
