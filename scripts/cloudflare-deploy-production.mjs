#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkOpenNextOutput } from "./check-open-next-output.mjs";
import {
  materializeProductionConfigs,
  resolveTool,
  runProcess,
  runReadOnlySchemaPreflight,
  runRemoteSecretPreflight,
  verifyProductionEnvironment,
} from "./cloudflare-production.mjs";

export function deploymentEnvironment(
  env,
  { service, preserveWorkersBuildName = false },
) {
  const childEnv = { ...env };
  const override = childEnv.WRANGLER_CI_OVERRIDE_NAME?.trim() ?? "";
  if (preserveWorkersBuildName) {
    if (override && override !== service) {
      throw new Error(
        `WRANGLER_CI_OVERRIDE_NAME must be ${service} for the web deployment.`,
      );
    }
  } else {
    delete childEnv.WRANGLER_CI_OVERRIDE_NAME;
    delete childEnv.WRANGLER_CI_MATCH_TAG;
  }
  return childEnv;
}

export function deployProduction({
  env = process.env,
  repoRoot = process.cwd(),
  verify = verifyProductionEnvironment,
  prepareConfigs = materializeProductionConfigs,
  checkOutput = checkOpenNextOutput,
  schemaPreflight = runReadOnlySchemaPreflight,
  secretPreflight = runRemoteSecretPreflight,
  run = runProcess,
} = {}) {
  const verified = verify({ env, cwd: repoRoot });
  const configs = prepareConfigs({ env, repoRoot, commit: verified.commit });
  checkOutput({ env, repoRoot, commit: verified.commit });

  const openNextBin = resolveTool(
    repoRoot,
    "CLOUDFLARE_OPENNEXT_BIN",
    "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
    env,
  );
  const wranglerBin = resolveTool(
    repoRoot,
    "CLOUDFLARE_WRANGLER_BIN",
    "node_modules/wrangler/bin/wrangler.js",
    env,
  );

  secretPreflight({ env, repoRoot, configs, wranglerBin, run });

  schemaPreflight({
    env,
    repoRoot,
    webConfig: configs.web,
    wranglerBin,
    run,
  });

  const deploys = [
    {
      label: "cloudflare-deploy:flamenode-web",
      service: "flamenode-web",
      preserveWorkersBuildName: true,
      executable: process.execPath,
      args: [openNextBin, "deploy", "--config", configs.web],
    },
    {
      label: "cloudflare-deploy:flamenode-fast-jobs",
      service: "flamenode-fast-jobs",
      executable: process.execPath,
      args: [wranglerBin, "deploy", "--config", configs["fast-jobs"]],
    },
    {
      label: "cloudflare-deploy:flamenode-content-jobs",
      service: "flamenode-content-jobs",
      executable: process.execPath,
      args: [wranglerBin, "deploy", "--config", configs["content-jobs"]],
    },
    {
      label: "cloudflare-deploy:flamenode-sync-jobs",
      service: "flamenode-sync-jobs",
      executable: process.execPath,
      args: [wranglerBin, "deploy", "--config", configs["sync-jobs"]],
    },
  ];

  for (const deployment of deploys) {
    const { service, preserveWorkersBuildName, ...request } = deployment;
    run({
      ...request,
      cwd: repoRoot,
      env: deploymentEnvironment(env, {
        service,
        preserveWorkersBuildName,
      }),
    });
  }
  console.log("[cloudflare-deploy-production] OK (web -> fast -> content -> sync)");
  return { commit: verified.commit, configs, order: deploys.map((item) => item.label) };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    deployProduction();
  } catch (error) {
    console.error(`[cloudflare-deploy-production] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
