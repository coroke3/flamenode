import { z } from "zod";

/**
 * Terms version lifecycle rules of SA-051..055 (moved from
 * src/lib/actions/rules.ts). The action keeps the D1 reads, the full-row CAS +
 * strict audit, the rules static rebuild and revalidation.
 */

const TERMS_REACCEPT_MAX_CONTENT_LEN = 1000;

type Rejected = { ok: false; message: string };

const draftSchema = z.object({
  id: z.string().trim().optional(),
  version_label: z.string().trim().min(1).max(80),
  body_markdown: z.string().trim().min(1).max(40000),
  severity: z.enum(["minor", "major"]).default("minor"),
});

export type TermsDraftInput = z.infer<typeof draftSchema>;

/** SA-051/052. `entries` is `Object.fromEntries(formData)`. */
export function parseTermsDraftInput(
  entries: Record<string, unknown>,
): { ok: true; draft: TermsDraftInput } | Rejected {
  const parsed = draftSchema.safeParse(entries);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  return { ok: true, draft: parsed.data };
}

/** SA-053: archived versions never return; publishing a published one is a no-op success. */
export function decideTermsPublish(
  status: string | null,
): { kind: "rejected"; message: string } | { kind: "already_published" } | { kind: "publish" } {
  if (status === "archived") return { kind: "rejected", message: "アーカイブ済みの規約は再公開できません。" };
  if (status === "published") return { kind: "already_published" };
  return { kind: "publish" };
}

/** 秒精度でも公開順序が曖昧にならないよう、公開時刻を単調増加させる。 */
export function nextTermsPublishedAt(nowSeconds: number, currentPublishedAt: number | null | undefined): number {
  return Math.max(nowSeconds, (currentPublishedAt ?? 0) + 1);
}

/** SA-054 broadcastTermsReaccept input (confirm string, cursor bound, note truncation). */
export function parseTermsReacceptBroadcastInput(raw: {
  termsId: unknown;
  confirm: unknown;
  cursor: unknown;
  content: unknown;
}): { ok: true; termsId: string; cursor: string; content: string } | Rejected {
  const termsId = String(raw.termsId ?? "").trim();
  const confirm = String(raw.confirm ?? "").trim();
  const cursor = String(raw.cursor ?? "").trim();
  if (!termsId) return { ok: false, message: "terms_id が必要です。" };
  if (confirm !== "TERMS") return { ok: false, message: "確認文字列 'TERMS' が一致しません。" };
  if (cursor.length > 128) return { ok: false, message: "cursor が長すぎます。" };
  const content = String(raw.content ?? "").trim().slice(0, TERMS_REACCEPT_MAX_CONTENT_LEN);
  return { ok: true, termsId, cursor, content };
}
