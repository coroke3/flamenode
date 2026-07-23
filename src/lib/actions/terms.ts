"use server";

import { redirect } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabaseAsync } from "@/lib/cloudflare";
import {
  termsVersions,
  userTosConsents,
  users,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { sanitizeNextPath } from "#utils/next";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { AuditMutationError, mutateWithAudit } from "@/lib/audit/mutate";
import {
  createTraceId,
  logFlowTrace,
} from "@/lib/observability/flowTrace";

const FALLBACK_TERMS_VERSION_ID = "fallback-current";

export type AcceptTermsResult =
  | { kind: "accepted"; termsVersionId: string }
  | { kind: "already_accepted"; termsVersionId: string }
  | { kind: "not_authenticated" }
  | { kind: "user_missing" }
  | { kind: "terms_unavailable" }
  | { kind: "database_unavailable"; retryable: true }
  | { kind: "concurrent_update"; retryable: true };

function termsCasCondition(userBefore: {
  id: string;
  accepted_terms_version_id: string | null;
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
}) {
  return expectedRowCondition({
    expectedCurrent: {
      id: userBefore.id,
      accepted_terms_version_id: userBefore.accepted_terms_version_id,
      is_tos_accepted: userBefore.is_tos_accepted ?? 0,
      terms_reaccept_required: userBefore.terms_reaccept_required ?? 0,
    },
  });
}

function alreadyAccepted(
  userBefore: {
    accepted_terms_version_id: string | null;
    is_tos_accepted: number | null;
    terms_reaccept_required: number | null;
  },
  termsVersionId: string,
): boolean {
  return (
    userBefore.accepted_terms_version_id === termsVersionId &&
    (userBefore.is_tos_accepted ?? 0) === 1 &&
    (userBefore.terms_reaccept_required ?? 0) === 0
  );
}

/** Commitのみ。Navigationは呼び出し側。 */
export async function commitAcceptLatestTerms(
  userId: string,
): Promise<AcceptTermsResult> {
  const db = await getDatabaseAsync();
  if (!db) return { kind: "database_unavailable", retryable: true };

  const latest = (
    await db
      .select()
      .from(termsVersions)
      .where(eq(termsVersions.status, "published"))
      .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
      .limit(1)
  )[0];

  const termsVersionId = latest?.id ?? FALLBACK_TERMS_VERSION_ID;
  if (!latest && termsVersionId !== FALLBACK_TERMS_VERSION_ID) {
    return { kind: "terms_unavailable" };
  }

  const userBefore = (
    await db.select().from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!userBefore) return { kind: "user_missing" };

  const existingConsent = (
    await db
      .select({ id: userTosConsents.id })
      .from(userTosConsents)
      .where(
        and(
          eq(userTosConsents.user_id, userId),
          eq(userTosConsents.terms_version_id, termsVersionId),
        )!,
      )
      .limit(1)
  )[0];

  if (alreadyAccepted(userBefore, termsVersionId)) {
    return { kind: "already_accepted", termsVersionId };
  }

  const now = Math.floor(Date.now() / 1000);
  const consentAfter: typeof userTosConsents.$inferSelect = {
    id: existingConsent?.id ?? generateId("tos"),
    user_id: userId,
    terms_version_id: termsVersionId,
    consented_at: now,
    consent_context: "entry",
  };
  const userAfter = {
    ...userBefore,
    is_tos_accepted: 1,
    accepted_terms_version_id: termsVersionId,
    terms_reaccept_required: 0,
  };

  const mutationStatements = existingConsent
    ? [
        db
          .update(users)
          .set({
            is_tos_accepted: 1,
            accepted_terms_version_id: termsVersionId,
            terms_reaccept_required: 0,
          })
          .where(and(eq(users.id, userId), termsCasCondition(userBefore))!),
      ]
    : [
        db.insert(userTosConsents).values(consentAfter),
        db
          .update(users)
          .set({
            is_tos_accepted: 1,
            accepted_terms_version_id: termsVersionId,
            terms_reaccept_required: 0,
          })
          .where(and(eq(users.id, userId), termsCasCondition(userBefore))!),
      ];

  const expectedMutationChanges = existingConsent ? [1] : [1, 1];
  const audits = existingConsent
    ? [
        {
          table_name: "user" as const,
          target_id: userId,
          operation: "UPDATE" as const,
          before: { ...userBefore },
          after: { ...userAfter },
          actor_user_id: userId,
          retention_class: "long_audit" as const,
          context: "terms_accept",
          reason: `規約 ${termsVersionId} への同意状態修復`,
          strict: true,
        },
      ]
    : [
        {
          table_name: "user_tos_consents" as const,
          target_id: consentAfter.id,
          operation: "CREATE" as const,
          after: { ...consentAfter },
          actor_user_id: userId,
          retention_class: "long_audit" as const,
          context: "terms_accept",
          reason: `規約 ${termsVersionId} への同意`,
          strict: true,
        },
        {
          table_name: "user" as const,
          target_id: userId,
          operation: "UPDATE" as const,
          before: { ...userBefore },
          after: { ...userAfter },
          actor_user_id: userId,
          retention_class: "long_audit" as const,
          context: "terms_accept",
          reason: `規約 ${termsVersionId} への同意状態更新`,
          strict: true,
        },
      ];

  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuditMutationError) {
      // 競合後に再読取して既に同意済みなら成功扱い
      const again = (
        await db.select().from(users).where(eq(users.id, userId)).limit(1)
      )[0];
      if (again && alreadyAccepted(again, termsVersionId)) {
        return { kind: "already_accepted", termsVersionId };
      }
      return { kind: "concurrent_update", retryable: true };
    }
    throw error;
  }

  return { kind: "accepted", termsVersionId };
}

export async function acceptLatestTerms(formData: FormData): Promise<void> {
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const traceId = createTraceId();
  logFlowTrace({
    flow: "terms_accept",
    phase: "terms_accept_started",
    trace_id: traceId,
    result: "started",
  });

  const user = await getCurrentUser();
  if (!user) {
    logFlowTrace({
      flow: "terms_accept",
      phase: "terms_user_resolved",
      trace_id: traceId,
      result: "failed",
      error_code: "not_authenticated",
    });
    redirect(`/entry?next=${encodeURIComponent(next)}`);
  }

  logFlowTrace({
    flow: "terms_accept",
    phase: "terms_commit_started",
    trace_id: traceId,
    result: "started",
  });

  let result: AcceptTermsResult;
  try {
    result = await commitAcceptLatestTerms(user.id);
  } catch (error) {
    unstable_rethrow(error);
    logFlowTrace({
      flow: "terms_accept",
      phase: "terms_commit_started",
      trace_id: traceId,
      result: "failed",
      error_code: "commit_failed",
      committed: false,
      retryable: true,
    });
    redirect(`/rules?next=${encodeURIComponent(next)}&error=terms_commit_failed`);
  }

  if (result.kind === "accepted" || result.kind === "already_accepted") {
    logFlowTrace({
      flow: "terms_accept",
      phase: "terms_commit_succeeded",
      trace_id: traceId,
      result: "succeeded",
      committed: true,
    });
    logFlowTrace({
      flow: "terms_accept",
      phase: "terms_redirect_started",
      trace_id: traceId,
      result: "started",
      committed: true,
    });
    // 動的SSRのため revalidatePath は置かない。Commit後は新しいrequestへredirectのみ。
    redirect(next);
  }

  logFlowTrace({
    flow: "terms_accept",
    phase: "terms_commit_started",
    trace_id: traceId,
    result: "failed",
    error_code: result.kind,
    committed: false,
    retryable: "retryable" in result ? result.retryable : false,
  });

  if (result.kind === "not_authenticated" || result.kind === "user_missing") {
    redirect(`/entry?next=${encodeURIComponent(next)}`);
  }
  if (result.kind === "database_unavailable" || result.kind === "concurrent_update") {
    redirect(
      `/rules?next=${encodeURIComponent(next)}&error=${encodeURIComponent(result.kind)}`,
    );
  }
  redirect(
    `/rules?next=${encodeURIComponent(next)}&error=${encodeURIComponent(result.kind)}`,
  );
}
