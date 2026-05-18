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

fs.rmSync(target, { recursive: true, force: true });
console.log(`[clean-next-cache] Removed ${target}`);
