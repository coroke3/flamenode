/**
 * MIG-0645 U02b — one D1 atomic step and one R2 CAS progress advance.
 *
 * CURRENT RH-002 deliberately commits one step per HTTP request. A failed
 * R2 CAS after D1 succeeds must report committed_progress_pending; it must
 * not replay the D1 step or falsely imply rollback.
 *
 * This is an unmounted, dependency-injected unit. Authentication, authorization,
 * R2 owner claim and HTTP error mapping belong to the future guarded route.
 */
export type LegacyImportStepResult<Progress> = {
  progress: Progress;
  complete: boolean;
};

export type LegacyImportStepOutcome<Progress> =
  | { kind: "advanced"; step: LegacyImportStepResult<Progress>; expiresAt: number }
  | { kind: "committed_progress_pending"; step: LegacyImportStepResult<Progress>; cause: unknown };

export async function commitLegacyImportOneStep<Progress>(args: {
  applyStep: () => Promise<LegacyImportStepResult<Progress>>;
  advanceClaim: (progress: Progress) => Promise<number>;
  releaseClaim: () => Promise<void>;
}): Promise<LegacyImportStepOutcome<Progress>> {
  // Must not catch a successful D1 commit in a handler that retries it.
  let step: LegacyImportStepResult<Progress>;
  try {
    step = await args.applyStep();
  } catch (cause) {
    await args.releaseClaim().catch(() => undefined);
    throw cause;
  }

  try {
    const expiresAt = await args.advanceClaim(step.progress);
    return { kind: "advanced", step, expiresAt };
  } catch (cause) {
    await args.releaseClaim().catch(() => undefined);
    return { kind: "committed_progress_pending", step, cause };
  }
}
