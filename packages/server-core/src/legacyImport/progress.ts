/**
 * MIG-0645 U02a: pure RH-002 progress projection for the future Hono route.
 * Canonical deterministic stage progress projection for CURRENT Next and Hono.\n * No I/O, session, R2, D1, or mutation.
 */
export const LEGACY_IMPORT_X_USER_STEP_SIZE = 40;
export const LEGACY_IMPORT_SOFTWARE_STEP_SIZE = 40;
export const LEGACY_IMPORT_QUESTION_STEP_SIZE = 6;

export type LegacyImportStage =
  | "system_user" | "x_users" | "softwares" | "events"
  | "custom_questions" | "videos" | "complete";

export type LegacyImportProgress = { stage: LegacyImportStage; index: number };
export type LegacyImportProgressPlan = {
  xUsers: readonly unknown[];
  videoSoftwares: readonly { label: string }[];
  events: readonly unknown[];
  eventCustomQuestions: readonly unknown[];
  videos: readonly unknown[];
};
export type LegacyImportProgressSummary = {
  stage: string; index: number; completed: number; total: number;
};

export function legacyImportApplyProgressSummary(
  plan: LegacyImportProgressPlan,
  progress: LegacyImportProgress,
): LegacyImportProgressSummary {
  const softwareCount = new Set(
    plan.videoSoftwares
      .map((row) => row.label.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean),
  ).size;
  const sizes = {
    system_user: 1,
    x_users: Math.max(1, Math.ceil(plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE)),
    softwares: Math.max(1, Math.ceil(softwareCount / LEGACY_IMPORT_SOFTWARE_STEP_SIZE)),
    events: Math.max(1, plan.events.length),
    custom_questions: Math.max(
      1,
      Math.ceil(plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE),
    ),
    videos: Math.max(1, plan.videos.length),
  };
  const stages = ["system_user", "x_users", "softwares", "events", "custom_questions", "videos"] as const;
  const total = stages.reduce((sum, stage) => sum + sizes[stage], 0);
  const completed = progress.stage === "complete"
    ? total
    : stages
        .slice(0, stages.indexOf(progress.stage))
        .reduce((sum, stage) => sum + sizes[stage], 0) + progress.index;
  return { stage: progress.stage, index: progress.index, completed, total };
}

/**
 * RH-002 durable audit-marker fingerprint. Keep byte-for-byte parity with the
 * legacy CURRENT algorithm: JS UTF-16 code units, sorted input, NUL separator,
 * FNV-1a 64-bit wrap after each code unit; the prefix counts original IDs,
 * including duplicates. Do not normalize Unicode, deduplicate or change hash.
 */
export function legacyImportSkipSnapshotFingerprint(ids: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const canonical = [...ids].sort().join("\u0000");
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${ids.length}:${hash.toString(16).padStart(16, "0")}`;
}

/**
 * RH-002 strict CURRENT replay equality contract, exported for the Hono D1
 * writer. This compares a parsed persisted audit receipt against the caller's
 * run identity and the *recomputed* next progress. Never trust next counts or
 * skip sets carried by R2/audit rows without independently deriving progress.
 * JSON.stringify on counts intentionally matches the CURRENT key-order check.
 * The caller must separately validate receipt shape, outcome and uniqueness.
 */
export function legacyImportReceiptMatchesProgress(
  receipt: {
    runDigest: string; planHash: string; stage: string; index: number;
    nextStage: string; nextIndex: number; nextCounts: unknown;
    skipEventSnapshotFingerprint: string; skipVideoSnapshotFingerprint: string;
  },
  identity: { runDigest: string; planHash: string; stage: string; index: number },
  expected: {
    stage: string; index: number; counts: unknown;
    skipExistingEventIds: readonly string[]; skipExistingVideoIds: readonly string[];
  },
): boolean {
  return receipt.runDigest === identity.runDigest &&
    receipt.planHash === identity.planHash &&
    receipt.stage === identity.stage &&
    receipt.index === identity.index &&
    receipt.nextStage === expected.stage &&
    receipt.nextIndex === expected.index &&
    JSON.stringify(receipt.nextCounts) === JSON.stringify(expected.counts) &&
    receipt.skipEventSnapshotFingerprint === legacyImportSkipSnapshotFingerprint(expected.skipExistingEventIds) &&
    receipt.skipVideoSnapshotFingerprint === legacyImportSkipSnapshotFingerprint(expected.skipExistingVideoIds);
}
