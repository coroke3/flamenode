#!/usr/bin/env node
/** Fail-closed production environment validation without printing any value. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  redactOutput,
  verifyProductionEnvironment,
} from "./cloudflare-production.mjs";
import { checkCloudflareTemplate } from "./check-cloudflare-template.mjs";

export function checkCloudflareConfig({
  env = process.env,
  root = process.cwd(),
  verify = verifyProductionEnvironment,
} = {}) {
  const errors = checkCloudflareTemplate({ root });
  const mode = env.CLOUDFLARE_CONFIG_MODE?.trim();
  if (mode && mode !== "production") {
    errors.push("CLOUDFLARE_CONFIG_MODE only accepts production; placeholder fixture mode is retired");
  }
  if (env.CF_IDS_JSON?.trim()) {
    errors.push(
      "CF_IDS_JSON is retired; configure the named Workers Builds variables consumed by the production generator",
    );
  }
  if (fs.existsSync(path.join(root, "cloudflare", "ids.json"))) {
    errors.push(
      "cloudflare/ids.json is retired; production resource IDs must remain in Workers Builds variables only",
    );
  }

  try {
    verify({ env, cwd: root });
  } catch (error) {
    const message = error instanceof Error ? error.message : "production environment validation failed";
    errors.push(redactOutput(message, env));
  }
  return errors;
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const errors = checkCloudflareConfig();
  if (errors.length) {
    console.error("[check:cloudflare-config] FAILED (production)");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      "[check:cloudflare-config] OK (production variables, commit SHA, URLs, and tracked templates verified)",
    );
  }
}
