const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const target = path.resolve(workspace, ".next");
const expected = path.join(workspace, ".next");

if (target !== expected) {
  throw new Error(`Refusing to remove unexpected path: ${target}`);
}

if (!target.startsWith(workspace + path.sep)) {
  throw new Error(`Refusing to remove outside workspace: ${target}`);
}

if (!fs.existsSync(target)) {
  console.log("[clean-next-cache] .next does not exist; nothing to clean");
  process.exit(0);
}

try {
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 200,
  });
  console.log(`[clean-next-cache] Removed ${target}`);
} catch (err) {
  if (
    err &&
    typeof err === "object" &&
    ("code" in err) &&
    (err.code === "EPERM" || err.code === "EBUSY")
  ) {
    console.error(
      "[clean-next-cache] Failed to remove .next because another process is using it.",
    );
    console.error(
      "[clean-next-cache] Stop running Next.js dev/start/build processes for this workspace, then retry.",
    );
    process.exit(1);
  }
  throw err;
}
