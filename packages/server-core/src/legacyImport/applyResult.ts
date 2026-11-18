import type { CanonicalLegacyPlan } from "./normalize.ts";

/**
 * MIG-0645: pure CURRENT RH-002 apply result projection, shared by Next/Hono.
 * Source: src/lib/import/legacy/apply.ts#legacyApplyResultFromProgress
 */
export type LegacyApplyResult = {
  created: { events: number; videos: number; xUsers: number; authUsers: number; softwares: number };
  replaced: { events: number; videos: number };
  skipped: { events: number; videos: number };
  customQuestions: { created: number; reused: number };
  warnings: string[];
};

export type LegacyApplyResultProgress = {
  counts: {
    createdEvents: number;
    replacedEvents: number;
    skippedEvents: number;
    createdVideos: number;
    replacedVideos: number;
    skippedVideos: number;
    createdXUsers: number;
    createdAuthUsers: number;
    createdSoftwares: number;
    createdCustomQuestions: number;
    reusedCustomQuestions: number;
  };
};

export function legacyApplyResultFromProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyApplyResultProgress,
): LegacyApplyResult {
  return {
    created: {
      events: progress.counts.createdEvents,
      videos: progress.counts.createdVideos,
      xUsers: progress.counts.createdXUsers,
      authUsers: progress.counts.createdAuthUsers,
      softwares: progress.counts.createdSoftwares,
    },
    replaced: {
      events: progress.counts.replacedEvents,
      videos: progress.counts.replacedVideos,
    },
    skipped: {
      events: progress.counts.skippedEvents,
      videos: progress.counts.skippedVideos,
    },
    customQuestions: {
      created: progress.counts.createdCustomQuestions,
      reused: progress.counts.reusedCustomQuestions,
    },
    warnings: [...plan.warnings],
  };
}
