/**
 * Build-time snapshot access from the environment (MIG-0501 about-stats, MIG-0505 listings).
 * FLAMENODE_SNAPSHOT_DIR (holds `snapshot/...json`), FLAMENODE_SNAPSHOT_MANIFEST_FILE, FLAMENODE_SNAPSHOT_GENERATION.
 * null = no snapshot configured. An incomplete or unreadable configuration throws.
 */
import fs from "node:fs";
import path from "node:path";
import type { SnapshotLoadOptions, SnapshotSource } from "./publicDataLoader.ts";

export type SnapshotAccess = Readonly<{ source: SnapshotSource; options: SnapshotLoadOptions }>;

export function snapshotAccessFromEnv(env: Record<string, string | undefined> = process.env): SnapshotAccess | null {
  const dir = env.FLAMENODE_SNAPSHOT_DIR?.trim();
  const manifestFile = env.FLAMENODE_SNAPSHOT_MANIFEST_FILE?.trim();
  const generation = env.FLAMENODE_SNAPSHOT_GENERATION?.trim();
  if (!dir && !manifestFile && !generation) return null;
  if (!dir || !manifestFile || !generation) {
    throw new Error("Snapshot env incomplete: set FLAMENODE_SNAPSHOT_DIR, _MANIFEST_FILE and _GENERATION together");
  }
  return {
    source: {
      async read(key) {
        const file = path.join(dir, key);
        return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
      },
    },
    options: { manifest: JSON.parse(fs.readFileSync(manifestFile, "utf-8")), generation },
  };
}
