#!/usr/bin/env node
/**
 * Windows 等で vercel build の symlink が失敗する場合の pages:build 代替。
 * Docker が必要。Linux コンテナ内で next-on-pages を実行する。
 *
 * Usage: npm run pages:build:docker
 */
import { execSync } from "node:child_process";
import path from "node:path";

function toDockerMountPath(cwd) {
  const resolved = path.resolve(cwd);
  if (process.platform !== "win32") {
    return resolved;
  }
  const drive = resolved[0]?.toLowerCase();
  const rest = resolved.slice(2).replace(/\\/g, "/");
  return `/${drive}${rest}`;
}

function main() {
  const mount = toDockerMountPath(process.cwd());
  const cmd = [
    "docker run --rm",
    `-v "${mount}:/app"`,
    "-w /app",
    "-e CI=1",
    "node:20-bookworm",
    'bash -lc "npm ci && npm run pages:build"',
  ].join(" ");

  console.log("[pages:build:docker]", cmd);
  execSync(cmd, { stdio: "inherit" });
}

main();
