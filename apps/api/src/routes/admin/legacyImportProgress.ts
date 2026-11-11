/**
 * MIG-0645 U02a: pure RH-002 progress projection for the future Hono route.
 * No I/O, no session, no mutation. CURRENT source: app/api/admin/import/legacy/route.ts.
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
