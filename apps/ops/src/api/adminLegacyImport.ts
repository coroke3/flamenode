/**
 * MIG-0737 U02 / RH-002: legacy JSON/CSV/TSV preview/apply transport.
 * Non-routed transport only. No automatic apply retries: a committed step may have
 * succeeded even when the response is lost, so retry requires a fresh status check.
 * CURRENT: LegacyCanonicalImportClient.tsx -> POST /api/admin/import/legacy
 */
import { z } from "zod";
import type { OpsFetch, OpsResult } from "./read.js";

const rangeSchema = z.object({
  fileName: z.string().min(1),
  sourceRows: z.number().int().nonnegative(),
  startRow: z.number().int().positive(),
  endRow: z.number().int().positive(),
  selectedRows: z.number().int().nonnegative(),
});
const previewSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["preview", "apply"]).optional(),
  preview_token: z.string().min(1),
  plan_hash: z.string().min(1),
  expires_at: z.number().int().positive(),
  continuation_required: z.boolean().optional(),
  requires_field_mapping: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  summary: z.record(z.number()).optional(),
  file_ranges: z.array(rangeSchema).optional(),
  video_custom_field_candidates: z.array(z.object({
    source_key: z.string(),
    non_empty_rows: z.number().int().nonnegative(),
  })).optional(),
});
const applySchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["preview", "apply"]).optional(),
  continuation_required: z.boolean().optional(),
  committed: z.boolean().optional(),
  kind: z.string().optional(),
  expires_at: z.number().int().positive().optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  progress: z.object({
    stage: z.string(),
    index: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).optional(),
  result: z.unknown().optional(),
});
export type LegacyImportPreview = z.infer<typeof previewSchema>;
export type LegacyImportStep = z.infer<typeof applySchema>;
export type LegacyPreviewCredential = {
  token: string;
  planHash: string;
  expiresAt: number;
};
export type LegacyImportResponse<T> = OpsResult<T>;

function validCredential(c: LegacyPreviewCredential, now: number): boolean {
  return typeof c.token === "string" && c.token.length > 0 &&
    typeof c.planHash === "string" && c.planHash.length > 0 &&
    Number.isSafeInteger(c.expiresAt) && c.expiresAt > now;
}

async function submit<T>(
  fetchFn: OpsFetch,
  form: FormData,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<LegacyImportResponse<T>> {
  if (signal?.aborted) return { status: "unavailable" };
  try {
    const response = await fetchFn("/api/admin/import/legacy", {
      method: "POST",
      body: form,
      cache: "no-store",
      credentials: "same-origin",
      signal,
      // No content-type: browser generates the FormData multipart boundary.
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 404) return { status: "notFound" };
    if (response.status === 501) return { status: "unsupported" };
    if (response.status !== 200) return { status: "unavailable" };
    const parsed: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    const checked = schema.safeParse(parsed);
    return checked.success ? { status: "ok", data: checked.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function previewLegacyImport(
  fetchFn: OpsFetch,
  fields: FormData,
  files: ReadonlyArray<File>,
  decisions: ReadonlyArray<
    { source_key: string; action: "ignore" } |
    { source_key: string; action: "custom_question"; question_label: string }
  > = [],
  signal?: AbortSignal,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<LegacyImportResponse<LegacyImportPreview>> {
  if (files.length < 1 || files.some(f => !f.name || f.size < 0) ||
    decisions.some(d => !d.source_key.trim() ||
      (d.action === "custom_question" && (!d.question_label.trim() || d.question_label.length > 120)))) {
    return { status: "unavailable" };
  }
  const form = new FormData();
  // Preserve CURRENT form options without accidentally replaying stale preview credentials.
  for (const [key, value] of fields.entries()) {
    if (key !== "mode" && key !== "preview_token" && key !== "plan_hash" &&
        key !== "files" && key !== "video_custom_field_decisions") {
      form.append(key, value);
    }
  }
  form.set("mode", "preview");
  form.set("video_custom_field_decisions", JSON.stringify(decisions));
  for (const file of files) form.append("files", file);
  const result = await submit(fetchFn, form, previewSchema, signal);
  if (result.status === "ok" && result.data.expires_at <= nowSeconds) {
    return { status: "unavailable" };
  }
  return result;
}

/** Apply *one* committed step. Calling code must confirm and handle continuation manually. */
export async function applyLegacyImportStep(
  fetchFn: OpsFetch,
  credential: LegacyPreviewCredential,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  signal?: AbortSignal,
): Promise<LegacyImportResponse<LegacyImportStep>> {
  if (!validCredential(credential, nowSeconds)) return { status: "unavailable" };
  const form = new FormData();
  form.set("mode", "apply");
  form.set("preview_token", credential.token);
  form.set("plan_hash", credential.planHash);
  return submit(fetchFn, form, applySchema, signal);
}
