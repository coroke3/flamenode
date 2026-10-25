/**
 * Build-time source for the `/about` stats (MIG-0501, lead decision: `about-stats` snapshot kind).
 * Unset env = no snapshot published = stats hidden. A snapshot that fails any check is also hidden,
 * as CURRENT `AboutStats` renders nothing when its fetch fails; the reason is logged for the build.
 * Env: FLAMENODE_SNAPSHOT_DIR (holds `snapshot/about-stats/current.json`), FLAMENODE_SNAPSHOT_MANIFEST_FILE,
 * FLAMENODE_SNAPSHOT_GENERATION.
 */
import {
  ABOUT_STATS_KEY,
  loadAboutStatsSnapshot,
  type AboutStatsSnapshot,
} from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";

export async function loadAboutStatsForBuild(
  env: Record<string, string | undefined> = process.env,
): Promise<AboutStatsSnapshot | null> {
  try {
    const access = snapshotAccessFromEnv(env);
    if (!access) return null;
    return await loadAboutStatsSnapshot(access.source, access.options);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "UNKNOWN";
    console.warn(`[about-stats] hidden: snapshot ${ABOUT_STATS_KEY} unavailable (${code})`);
    return null;
  }
}
