const { existsSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const nextOnPagesEntry = join(
  root,
  "node_modules",
  "@cloudflare",
  "next-on-pages",
  "dist",
  "index.js",
);
const shim = join(__dirname, "next-on-pages-windows-shim.cjs");

const env = { ...process.env };
const requireShimOption = `--require=${shim}`;
env.NODE_OPTIONS = [env.NODE_OPTIONS, requireShimOption].filter(Boolean).join(" ");

if (process.platform === "win32") {
  const toGitBashPath = (value) => {
    const normalized = value.replace(/\\/g, "/");
    const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
    if (!drive) return normalized;
    return `/${drive[1].toLowerCase()}/${drive[2]}`;
  };
  const candidates = [
    dirname(process.execPath),
    join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin"),
    join(process.env.ProgramFiles || "C:\\Program Files", "Git", "usr", "bin"),
  ].filter(existsSync);
  if (candidates.length > 0) {
    env.PATH = candidates.map(toGitBashPath).join(":");
  }
}

const cliArgs = process.argv.slice(2);
const hasSkipBuild = cliArgs.includes("--skip-build") || cliArgs.includes("-s");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? env,
    shell: options.shell ?? false,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 0;
}

if (process.platform === "win32" && !hasSkipBuild) {
  const vercelEnv = { ...env, PATH: process.env.PATH };
  const vercelStatus = run("npx.cmd", ["vercel", "build"], {
    env: vercelEnv,
    shell: true,
  });
  if (vercelStatus !== 0) process.exit(vercelStatus);
  cliArgs.unshift("--skip-build");
}

const status = run(process.execPath, [
  "--require",
  shim,
  nextOnPagesEntry,
  ...cliArgs,
]);
process.exit(status);
