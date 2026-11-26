// D-16-1 provisional: replace with @flamenode/contracts at merge
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
// CURRENT normalize.ts accepts at most 50 decision source keys, 120 characters each.
// Validation responses cannot grant apply credentials. Keep only the bounded DTO.
const validationCandidateSchema = z.object({
  source_key: z.string().min(1).max(120).refine(key => key === key.trim() &&
    !/[\u0000-\u001F\u007F]/.test(key)),
  non_empty_rows: z.number().int().positive().safe(),
});
const previewValidationSchema = z.object({
  ok: z.literal(false),
  mode: z.literal("preview"),
  video_custom_field_candidates: z.array(validationCandidateSchema).max(50)
    .refine(candidates => new Set(candidates.map(candidate => candidate.source_key)).size === candidates.length),
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
const recoveryProgressSchema = z.object({
  stage: z.enum(["system_user", "x_users", "softwares", "events", "custom_questions", "videos", "complete"]),
  index: z.number().int().nonnegative().safe(),
  completed: z.number().int().nonnegative().safe(),
  total: z.number().int().positive().safe(),
}).refine(progress => progress.index <= progress.completed && progress.completed <= progress.total &&
  (progress.stage === "complete"
    ? progress.index === 0 && progress.completed === progress.total
    : progress.completed < progress.total));
const committedPendingSchema = z.object({
  ok: z.literal(false),
  committed: z.literal(true),
  kind: z.literal("committed_progress_pending"),
  retryable: z.literal(true),
  requires_repreview: z.literal(false),
  plan_hash: z.string().min(1),
  attempt: z.number().int().positive().safe(),
  progress: recoveryProgressSchema,
  result: z.object({ complete: z.boolean() }),
}).refine(response => response.result.complete === (response.progress.stage === "complete"));

export type LegacyImportPreview = z.infer<typeof previewSchema>;
export type LegacyImportStep = z.infer<typeof applySchema>;
export type LegacyPreviewCredential = {
  token: string;
  planHash: string;
  expiresAt: number;
};
export type LegacyImportResponse<T> = OpsResult<T>;
export type LegacyImportPreviewResponse = LegacyImportResponse<LegacyImportPreview> |
  { status: "previewValidationFailed"; httpStatus: 413 | 422;
    candidates: z.infer<typeof validationCandidateSchema>[] };
export type LegacyImportApplyResponse = LegacyImportResponse<LegacyImportStep> |
  { status: "committedProgressPending"; progress: z.infer<typeof recoveryProgressSchema> };

const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

function validCredential(c: LegacyPreviewCredential, now: number): boolean {
  return typeof c.token === "string" && c.token.length > 0 &&
    typeof c.planHash === "string" && c.planHash.length > 0 &&
    Number.isSafeInteger(c.expiresAt) && c.expiresAt > now;
}

/** Bound untrusted error bodies before parsing, including responses without Content-Length. */
async function readBoundedErrorJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return null;
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > MAX_ERROR_RESPONSE_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
    return null;
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

async function submit(
  fetchFn: OpsFetch,
  form: FormData,
  signal?: AbortSignal,
): Promise<OpsResult<{ httpStatus: number; body: unknown }>> {
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
    const mode = form.get("mode");
    const knownError = (mode === "apply" && (response.status === 409 || response.status === 503)) ||
      (mode === "preview" && (response.status === 413 || response.status === 422));
    if (response.status !== 200 && !knownError) return { status: "unavailable" };
    const parsed: unknown = response.status === 200
      ? await response.json()
      : await readBoundedErrorJson(response, signal);
    if (signal?.aborted) return { status: "unavailable" };
    return { status: "ok", data: { httpStatus: response.status, body: parsed } };
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
): Promise<LegacyImportPreviewResponse> {
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
  const result = await submit(fetchFn, form, signal);
  if (result.status !== "ok") return result;
  if (result.data.httpStatus === 413 || result.data.httpStatus === 422) {
    const rejected = previewValidationSchema.safeParse(result.data.body);
    return rejected.success ? { status: "previewValidationFailed", httpStatus: result.data.httpStatus,
      candidates: rejected.data.video_custom_field_candidates } : { status: "unavailable" };
  }
  const checked = previewSchema.safeParse(result.data.body);
  return checked.success && checked.data.expires_at > nowSeconds
    ? { status: "ok", data: checked.data }
    : { status: "unavailable" };
}

/** Apply *one* committed step. Calling code must confirm and handle continuation manually. */
export async function applyLegacyImportStep(
  fetchFn: OpsFetch,
  credential: LegacyPreviewCredential,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  signal?: AbortSignal,
): Promise<LegacyImportApplyResponse> {
  if (!validCredential(credential, nowSeconds)) return { status: "unavailable" };
  const form = new FormData();
  form.set("mode", "apply");
  form.set("preview_token", credential.token);
  form.set("plan_hash", credential.planHash);
  const result = await submit(fetchFn, form, signal);
  if (result.status !== "ok") return result;
  if (result.data.httpStatus === 200) {
    const checked = applySchema.safeParse(result.data.body);
    return checked.success ? { status: "ok", data: checked.data } : { status: "unavailable" };
  }
  const recovery = committedPendingSchema.safeParse(result.data.body);
  if (!recovery.success || recovery.data.plan_hash !== credential.planHash) return { status: "unavailable" };
  // The view needs confirmed progress, never provider messages, credentials or raw result fields.
  return { status: "committedProgressPending", progress: recovery.data.progress };
}
