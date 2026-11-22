/**
 * Build-time source for the `/about` stats (MIG-0501, lead decision: `about-stats` snapshot kind).
 * Unset env = no snapshot published = stats hidden. A snapshot that fails any check is also hidden,
 * as CURRENT `AboutStats` renders nothing when its fetch fails; the reason is logged for the build.
 * Env: FLAMENODE_SNAPSHOT_DIR (holds `snapshot/about-stats/current.json`), FLAMENODE_SNAPSHOT_MANIFEST_FILE,
 * FLAMENODE_SNAPSHOT_GENERATION.
 */
import {
  ABOUT_STATS_KEY,
  SnapshotBuildError,
  loadAboutStatsSnapshot,
  type AboutStatsSnapshot,
} from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";

// Only bounded, known loader codes may appear in build diagnostics.
const SAFE_SNAPSHOT_CODES = new Set([
  "MANIFEST_UNAVAILABLE", "INVALID_KEY", "NOT_PUBLIC", "INVALID_LIMIT",
  "SOURCE_UNAVAILABLE", "SNAPSHOT_MISSING", "INVALID_SIZE", "INVALID_JSON",
  "INVALID_ENVELOPE", "GENERATION_MISMATCH", "INVALID_HASH", "HASH_MISMATCH",
  "INVALID_PAYLOAD", "ENTITY_MISMATCH",
]);

export async function loadAboutStatsForBuild(
  env: Record<string, string | undefined> = process.env,
): Promise<AboutStatsSnapshot | null> {
  try {
    const access = snapshotAccessFromEnv(env);
    if (!access) return null;
    return await loadAboutStatsSnapshot(access.source, access.options);
  } catch (error) {
    let code = "UNKNOWN";
    try {
      // Provider exceptions, Proxy traps and code accessors are untrusted.
      if (error instanceof SnapshotBuildError) {
        const candidate: unknown = error.code;
        if (typeof candidate === "string" && SAFE_SNAPSHOT_CODES.has(candidate)) code = candidate;
      }
    } catch {
      // A diagnostic failure must never abort the optional snapshot fallback.
    }
    try {
      console.warn(`[about-stats] hidden: snapshot ${ABOUT_STATS_KEY} unavailable (${code})`);
    } catch {
      // Astro still builds without optional statistics when the log sink fails.
    }
    return null;
  }
}
