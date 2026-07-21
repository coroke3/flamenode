#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  materializeProductionConfigs,
  verifyProductionEnvironment,
} from "./cloudflare-production.mjs";

export function verifyCloudflareProduction({
  env = process.env,
  repoRoot = process.cwd(),
  generateConfigs = true,
} = {}) {
  const verified = verifyProductionEnvironment({ env, cwd: repoRoot });
  const configs = generateConfigs
    ? materializeProductionConfigs({ env, repoRoot, commit: verified.commit })
    : null;
  return { ...verified, configs };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    const result = verifyCloudflareProduction();
    const configCount = result.configs ? Object.keys(result.configs).length : 0;
    console.log(`[cloudflare-verify-environment] OK (${configCount} production configs verified)`);
  } catch (error) {
    console.error(`[cloudflare-verify-environment] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
