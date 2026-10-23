/**
 * Build-time source for the `/about` stats (MIG-0501, lead decision: `about-stats` snapshot kind).
 * Unset env = no snapshot published = stats hidden. A snapshot that fails any check is also hidden,
 * as CURRENT `AboutStats` renders nothing when its fetch fails; the reason is logged for the build.
 * Env: FLAMENODE_SNAPSHOT_DIR (holds `snapshot/about-stats/current.json`), FLAMENODE_SNAPSHOT_MANIFEST_FILE,
 * FLAMENODE_SNAPSHOT_GENERATION.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ABOUT_STATS_KEY,
  loadAboutStatsSnapshot,
  type AboutStatsSnapshot,
  type SnapshotManifest,
  type SnapshotSource,
} from "./publicDataLoader.ts";

export async function loadAboutStatsForBuild(
  env: Record<string, string | undefined> = process.env,
  source?: SnapshotSource,
): Promise<AboutStatsSnapshot | null> {
  const dir = env.FLAMENODE_SNAPSHOT_DIR?.trim();
  const manifestFile = env.FLAMENODE_SNAPSHOT_MANIFEST_FILE?.trim();
  const generation = env.FLAMENODE_SNAPSHOT_GENERATION?.trim();
  if (!source && (!dir || !manifestFile || !generation)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile!, "utf-8")) as SnapshotManifest;
    const fileSource: SnapshotSource = source ?? {
      async read(key) {
        const file = path.join(dir!, key);
        return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
      },
    };
    return await loadAboutStatsSnapshot(fileSource, { manifest, generation: generation! });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "UNKNOWN";
    console.warn(`[about-stats] hidden: snapshot ${ABOUT_STATS_KEY} unavailable (${code})`);
    return null;
  }
}
