import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TSX_TEST_ENTRY_ENV = "FLAMENODE_TSX_TEST_ENTRY";

/**
 * Re-run a Node test file with tsx so TypeScript modules use the same resolver
 * on every supported platform. Returns true only inside the tsx-enabled run.
 */
export function runTestWithTsx(entryUrl) {
  const entryPath = fileURLToPath(entryUrl);
  if (process.env[TSX_TEST_ENTRY_ENV] === entryPath) return true;

  const env = {
    ...process.env,
    [TSX_TEST_ENTRY_ENV]: entryPath,
  };
  delete env.NODE_TEST_CONTEXT;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", entryPath],
    {
      stdio: "inherit",
      env,
      windowsHide: true,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return false;
}
