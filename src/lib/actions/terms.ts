"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabaseAsync } from "@/lib/cloudflare";
import {
  termsVersions,
  userTosConsents,
  users,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { sanitizeNextPath } from "#utils/next";

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

  await db.insert(userTosConsents).values({
    id: generateId("tos"),
    user_id: user.id,
    terms_version_id: termsVersionId,
    consented_at: now,
    consent_context: "entry",
  });

  await db
    .update(users)
    .set({
      is_tos_accepted: 1,
      accepted_terms_version_id: termsVersionId,
      terms_reaccept_required: 0,
    })
    .where(eq(users.id, user.id));

  revalidatePath("/rules");
  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  revalidateSafePath(next);
  redirect(next);
}
