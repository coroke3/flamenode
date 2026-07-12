"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
import { mutateWithAudit } from "@/lib/audit/mutate";

const FALLBACK_TERMS_VERSION_ID = "fallback-current";

function revalidateSafePath(next: string): void {
  const path = next.split(/[?#]/, 1)[0] || "/dashboard";
  revalidatePath(path);
}

export async function acceptLatestTerms(formData: FormData): Promise<void> {
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/entry?next=${encodeURIComponent(next)}`);
  }

  const db = await getDatabaseAsync();
  if (!db) {
    redirect(`/rules?next=${encodeURIComponent(next)}`);
  }

  const latest = (
    await db
      .select()
      .from(termsVersions)
      .where(eq(termsVersions.status, "published"))
      .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
      .limit(1)
  )[0];

  const now = Math.floor(Date.now() / 1000);
  const termsVersionId = latest?.id ?? FALLBACK_TERMS_VERSION_ID;
  const userBefore = (
    await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  )[0];
  if (!userBefore) {
    redirect(`/entry?next=${encodeURIComponent(next)}`);
  }
  const consentAfter: typeof userTosConsents.$inferSelect = {
    id: generateId("tos"),
    user_id: user.id,
    terms_version_id: termsVersionId,
    consented_at: now,
    consent_context: "entry",
  };
  const userAfter = {
    ...userBefore,
    is_tos_accepted: 1,
    accepted_terms_version_id: termsVersionId,
    // 表示用mirror。判定正本はaccepted versionとconsent履歴。
    terms_reaccept_required: 0,
  };

  await mutateWithAudit(db, {
    mutationStatements: [
      db.insert(userTosConsents).values(consentAfter),
      db
        .update(users)
        .set({
          is_tos_accepted: 1,
          accepted_terms_version_id: termsVersionId,
          terms_reaccept_required: 0,
        })
        .where(and(
          eq(users.id, user.id),
          expectedRowCondition({ expectedCurrent: { ...userBefore } }),
        )!),
    ],
    expectedMutationChanges: [1, 1],
    audits: [
      {
        table_name: "user_tos_consents",
        target_id: consentAfter.id,
        operation: "CREATE",
        after: { ...consentAfter },
        actor_user_id: user.id,
        retention_class: "long_audit",
        context: "terms_accept",
        reason: `規約 ${termsVersionId} への同意`,
        strict: true,
      },
      {
        table_name: "user",
        target_id: user.id,
        operation: "UPDATE",
        before: { ...userBefore },
        after: { ...userAfter },
        actor_user_id: user.id,
        retention_class: "long_audit",
        context: "terms_accept",
        reason: `規約 ${termsVersionId} への同意状態更新`,
        strict: true,
      },
    ],
  });

  revalidatePath("/rules");
  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  revalidateSafePath(next);
  redirect(next);
}
