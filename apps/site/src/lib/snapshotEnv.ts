/**
 * Build-time snapshot access from the environment (MIG-0501 about-stats, MIG-0505 listings).
 * FLAMENODE_SNAPSHOT_DIR (holds `snapshot/...json`), FLAMENODE_SNAPSHOT_MANIFEST_FILE, FLAMENODE_SNAPSHOT_GENERATION.
 * null = no snapshot configured. An incomplete or unreadable configuration throws.
 */
import fs from "node:fs";
import path from "node:path";
import type { SnapshotLoadOptions, SnapshotSource } from "./publicDataLoader.ts";

export type SnapshotAccess = Readonly<{ source: SnapshotSource; options: SnapshotLoadOptions }>;

/** A snapshot key must resolve to a file inside the configured root, not an ancestor or sibling. */
function isInsideSnapshotRoot(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function snapshotAccessFromEnv(env: Record<string, string | undefined> = process.env): SnapshotAccess | null {
  const dir = env.FLAMENODE_SNAPSHOT_DIR?.trim();
  const manifestFile = env.FLAMENODE_SNAPSHOT_MANIFEST_FILE?.trim();
  const generation = env.FLAMENODE_SNAPSHOT_GENERATION?.trim();
  if (!dir && !manifestFile && !generation) return null;
  if (!dir || !manifestFile || !generation) {
    throw new Error("Snapshot env incomplete: set FLAMENODE_SNAPSHOT_DIR, _MANIFEST_FILE and _GENERATION together");
  }
  const root = path.resolve(dir);
  let realRoot: string | null = null;
  return {
    source: {
      async read(key) {
        // Snapshot keys are validated by the normal build loader, but
        // this filesystem adapter must not allow a malformed key or symlink to escape the root.
        if (!key || path.isAbsolute(key) || key.includes("\\") || key.includes("\0")) return null;
        const file = path.resolve(root, key);
        if (!isInsideSnapshotRoot(root, file) || !fs.existsSync(file)) return null;

        // Resolve symlinks before reading: a snapshot entry must never dereference a file
        // outside the snapshot root, even if its lexically normalized path looks safe.
        realRoot ??= fs.realpathSync(root);
        const actualFile = fs.realpathSync(file);
        if (!isInsideSnapshotRoot(realRoot, actualFile) || !fs.statSync(actualFile).isFile()) {
          return null;
        }
        return new Uint8Array(fs.readFileSync(actualFile));
      },
    },
    options: { manifest: JSON.parse(fs.readFileSync(manifestFile, "utf-8")), generation },
  };
}
