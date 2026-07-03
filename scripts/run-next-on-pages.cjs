const { existsSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

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

const child = spawn(
  process.execPath,
  ["--require", shim, nextOnPagesEntry, ...process.argv.slice(2)],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
