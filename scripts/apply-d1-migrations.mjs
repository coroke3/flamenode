#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { materializeD1CompatibleMigrations } from "./d1-migration-compat.mjs";

const root = process.cwd();
const mode = process.argv[2];
if (mode !== "local" && mode !== "remote") {
  throw new Error(
    "Usage: node scripts/apply-d1-migrations.mjs <local|remote> [--config path] [--persist-to path]",
  );
}

const args = process.argv.slice(3);
function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const allowed = new Set(["--config", "--persist-to"]);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--yes") {
    throw new Error(
      "Unsupported argument: --yes. Wrangler 4 skips D1 migration confirmation automatically in CI/CD; do not forward a legacy auto-confirm flag.",
    );
  }
  if (!allowed.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
  index += 1;
}
if (mode === "remote" && args.includes("--persist-to")) {
  throw new Error("--persist-to is only available in local mode");
}

const sourceConfigPath = path.resolve(root, optionValue("--config") ?? "wrangler.toml");
const sourceConfig = fs.readFileSync(sourceConfigPath, "utf8");
const d1Blocks = sourceConfig.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|\n\[[^[]|$)/g) ?? [];
const d1Block = d1Blocks.find((block) =>
  /database_name\s*=\s*"flamenode_db"/.test(block),
);
if (!d1Block) throw new Error(`${sourceConfigPath}: flamenode_db binding not found`);

const migrations = materializeD1CompatibleMigrations(path.join(root, "migrations"));
try {
  const configPath = path.join(migrations.workspace, "wrangler.toml");
  const migrationsPath = migrations.outputDir.replaceAll("\\", "/");
  const normalizedD1Block = /migrations_dir\s*=/.test(d1Block)
    ? d1Block.replace(
        /^(\s*migrations_dir\s*=\s*)"[^"]*"\s*$/m,
        `$1"${migrationsPath}"`,
      )
    : `${d1Block.trimEnd()}\nmigrations_dir = "${migrationsPath}"\n`;
  fs.writeFileSync(
    configPath,
    [
      'name = "flamenode-d1-safe-migration"',
      'compatibility_date = "2026-07-20"',
      "",
      normalizedD1Block.trim(),
      "",
    ].join("\n"),
    "utf8",
  );

  const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const wranglerArgs = [
    wranglerBin,
    "d1",
    "migrations",
    "apply",
    "flamenode_db",
    mode === "remote" ? "--remote" : "--local",
    "--config",
    configPath,
  ];
  if (mode === "local") {
    wranglerArgs.push(
      "--persist-to",
      path.resolve(root, optionValue("--persist-to") ?? path.join(".wrangler", "state")),
    );
  }

  const result = spawnSync(process.execPath, wranglerArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(migrations.workspace, { recursive: true, force: true });
}
