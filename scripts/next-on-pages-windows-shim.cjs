const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform === "win32") {
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalSymlink = fs.symlink;
  const originalSymlinkSync = fs.symlinkSync;
  const originalPromisesSymlink = fs.promises.symlink.bind(fs.promises);
  const nodeBinDir = path.dirname(process.execPath);
  const gitBash = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "usr", "bin", "bash.exe"),
  ].find(fs.existsSync);

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

  const shouldCopyInstead = (error) =>
    error && (error.code === "EPERM" || error.code === "EACCES");

  const resolveSymlinkTarget = (target, linkPath) => {
    const targetPath = path.normalize(String(target));
    if (path.isAbsolute(targetPath)) return targetPath;
    return path.resolve(path.dirname(String(linkPath)), targetPath);
  };

  const copySymlinkTargetSync = (target, linkPath, error) => {
    const source = resolveSymlinkTarget(target, linkPath);
    if (!fs.existsSync(source)) throw error;
    fs.cpSync(source, linkPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  };

  const copySymlinkTarget = async (target, linkPath, error) => {
    const source = resolveSymlinkTarget(target, linkPath);
    if (!fs.existsSync(source)) throw error;
    await fs.promises.cp(source, linkPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  };

  fs.symlinkSync = function patchedSymlinkSync(target, linkPath, type) {
    try {
      return originalSymlinkSync.call(this, target, linkPath, type);
    } catch (error) {
      if (!shouldCopyInstead(error)) throw error;
      return copySymlinkTargetSync(target, linkPath, error);
    }
  };

  fs.symlink = function patchedSymlink(target, linkPath, type, callback) {
    let actualType = type;
    let actualCallback = callback;
    if (typeof actualType === "function") {
      actualCallback = actualType;
      actualType = undefined;
    }
    return originalSymlink.call(
      this,
      target,
      linkPath,
      actualType,
      async (error) => {
        if (!error) {
          actualCallback(null);
          return;
        }
        if (!shouldCopyInstead(error)) {
          actualCallback(error);
          return;
        }
        try {
          await copySymlinkTarget(target, linkPath, error);
          actualCallback(null);
        } catch (copyError) {
          actualCallback(copyError);
        }
      },
    );
  };

  fs.promises.symlink = async function patchedPromisesSymlink(
    target,
    linkPath,
    type,
  ) {
    try {
      return await originalPromisesSymlink(target, linkPath, type);
    } catch (error) {
      if (!shouldCopyInstead(error)) throw error;
      return copySymlinkTarget(target, linkPath, error);
    }
  };
}
