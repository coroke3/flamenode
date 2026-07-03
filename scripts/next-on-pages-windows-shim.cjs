const childProcess = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

if (process.platform === "win32") {
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const nodeBinDir = path.dirname(process.execPath);
  const gitBash = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "usr", "bin", "bash.exe"),
  ].find(existsSync);

  const resolveWindowsCommand = (command) => {
    if (command === "npm" || command === "npx") {
      return path.join(nodeBinDir, `${command}.cmd`);
    }
    if (command === "bash" && gitBash) {
      return gitBash;
    }
    return command;
  };

  childProcess.spawn = function patchedSpawn(command, args, options) {
    return originalSpawn.call(
      this,
      resolveWindowsCommand(command),
      args,
      options,
    );
  };

  childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
    return originalSpawnSync.call(
      this,
      resolveWindowsCommand(command),
      args,
      options,
    );
  };
}
