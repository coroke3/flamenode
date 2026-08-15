import { normalizeXId } from "#utils/xid";
import type { ParsedMemberChapter } from "./memberInputs.ts";
import type { MemberSubmissionBaseline } from "./memberSubmissionCompare.ts";

export type MemberChapterIdentityRemap =
  | {
      ok: true;
      /** Chapters in the submitted member order, preserving the stored rows. */
      bySubmittedIndex: Map<number, ParsedMemberChapter[]>;
      /** Submitted chapter payload projected onto the existing member order. */
      byBaselineIndex: Map<number, ParsedMemberChapter[]>;
      /** A newly submitted member carried chapters without a stable match. */
      unmatchedSubmittedWithChapters: boolean;
    }
  | {
      ok: false;
      reason:
        | "duplicate_submitted_x_user_id"
        | "duplicate_baseline_x_user_id"
        | "ambiguous_member_name"
        | "conflicting_member_identity";
    };

function normalizedMemberName(value: string | null | undefined): string {
  return (value ?? "").trim().normalize("NFKC").toLowerCase();
}

function normalizedMemberXId(value: string | null | undefined): string {
  return normalizeXId(value ?? "");
}

function addIndex(
  index: Map<string, number[]>,
  key: string,
  value: number,
): void {
  if (!key) return;
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function uniqueIndexValue(
  index: Map<string, number[]>,
  key: string,
): number | null {
  const values = index.get(key) ?? [];
  return values.length === 1 ? values[0]! : null;
}

/**
 * Keep stored member chapters attached to their member when a caller with
 * member-list permission reorders rows. The form payload has no DB member id,
 * so normalized X ID is preferred and normalized display name is the explicit
 * fallback. Ambiguous identities fail closed instead of moving chapters to a
 * different person.
 */
export function remapMemberChaptersByIdentity(
  baseline: MemberSubmissionBaseline,
  submitted: MemberSubmissionBaseline,
): MemberChapterIdentityRemap {
  const baselineByX = new Map<string, number[]>();
  const baselineByName = new Map<string, number[]>();
  const submittedByX = new Map<string, number[]>();
  for (const [index, member] of baseline.members.entries()) {
    addIndex(baselineByX, normalizedMemberXId(member.x_user_id), index);
    addIndex(baselineByName, normalizedMemberName(member.name), index);
  }
  for (const [index, member] of submitted.members.entries()) {
    addIndex(submittedByX, normalizedMemberXId(member.x_user_id), index);
  }
  if ([...baselineByX.values()].some((values) => values.length > 1)) {
    return { ok: false, reason: "duplicate_baseline_x_user_id" };
  }
  if ([...submittedByX.values()].some((values) => values.length > 1)) {
    return { ok: false, reason: "duplicate_submitted_x_user_id" };
  }

  const submittedToBaseline = new Map<number, number>();
  const consumedBaseline = new Set<number>();
  let unmatchedSubmittedWithChapters = false;
  for (const [submittedIndex, member] of submitted.members.entries()) {
    const xId = normalizedMemberXId(member.x_user_id);
    const name = normalizedMemberName(member.name);
    const xMatch = xId ? uniqueIndexValue(baselineByX, xId) : null;
    const nameValues = baselineByName.get(name) ?? [];
    const nameMatch = name
      ? nameValues.length === 1
        ? nameValues[0]!
        : null
      : null;

    if (nameValues.length > 1 && xMatch === null) {
      return { ok: false, reason: "ambiguous_member_name" };
    }
    if (xMatch !== null && nameMatch !== null && xMatch !== nameMatch) {
      return { ok: false, reason: "conflicting_member_identity" };
    }
    const match = xMatch ?? nameMatch;
    if (match === null) {
      if ((submitted.chaptersByIndex.get(submittedIndex) ?? []).length > 0) {
        unmatchedSubmittedWithChapters = true;
      }
      continue;
    }
    if (consumedBaseline.has(match)) {
      return { ok: false, reason: "conflicting_member_identity" };
    }
    consumedBaseline.add(match);
    submittedToBaseline.set(submittedIndex, match);
  }

  const bySubmittedIndex = new Map<number, ParsedMemberChapter[]>();
  const byBaselineIndex = new Map<number, ParsedMemberChapter[]>();
  for (const [submittedIndex, baselineIndex] of submittedToBaseline) {
    const submittedChapters = submitted.chaptersByIndex.get(submittedIndex) ?? [];
    const baselineChapters = baseline.chaptersByIndex.get(baselineIndex) ?? [];
    // A members-only form intentionally omits chapter data when the chapter
    // field is disabled. Preserve the stored rows in the submitted order;
    // non-empty payloads are still projected for the permission comparison.
    bySubmittedIndex.set(submittedIndex, baselineChapters);
    byBaselineIndex.set(
      baselineIndex,
      submittedChapters.length > 0 ? submittedChapters : baselineChapters,
    );
  }
  for (const [baselineIndex, chapters] of baseline.chaptersByIndex) {
    if (!byBaselineIndex.has(baselineIndex)) {
      byBaselineIndex.set(baselineIndex, chapters);
    }
  }

  return {
    ok: true,
    bySubmittedIndex,
    byBaselineIndex,
    unmatchedSubmittedWithChapters,
  };
}
