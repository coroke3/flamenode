"use server";

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import {
  termsVersions,
  userTosConsents,
  users,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

function sanitizeNextPath(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

export async function acceptLatestTerms(formData: FormData): Promise<void> {
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/entry?next=${encodeURIComponent(next)}`);
  }

  const db = getDatabase();
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

  if (!latest) {
    redirect(`/rules?next=${encodeURIComponent(next)}`);
  }

  const now = Math.floor(Date.now() / 1000);

  await db.insert(userTosConsents).values({
    id: generateId("tos"),
    user_id: user.id,
    terms_version_id: latest.id,
    consented_at: now,
    consent_context: "entry",
  });

  await db
    .update(users)
    .set({
      is_tos_accepted: 1,
      accepted_terms_version_id: latest.id,
      terms_reaccept_required: 0,
    })
    .where(eq(users.id, user.id));

  redirect(next);
}
