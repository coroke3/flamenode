#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { rejectBareWorkersCiWranglerDeploy } from "./cloudflare-production.mjs";

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    rejectBareWorkersCiWranglerDeploy();
  } catch (error) {
    console.error(`[workers-ci-wrangler-guard] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
