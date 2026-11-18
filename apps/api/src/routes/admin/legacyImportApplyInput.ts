import { legacyImportStringField } from "./legacyImportInput.ts";

/** MIG-0645 U02 apply entrypoint (unmounted).
 * CURRENT RH-002 validates existence, but not token/hash syntax, before
 * the owner-bound R2 claim. Syntax and authorization must remain at claim.
 * HTTP host must run same-origin/session/admin write/CostGuard before calling.
 */
export type LegacyImportApplyCredential =
  | { ok: true; previewToken: string; planHash: string }
  | { ok: false; status: 409; body: { ok: false; message: string; requires_repreview: true } };

export function legacyImportApplyCredential(formData: FormData): LegacyImportApplyCredential {
  const previewToken = legacyImportStringField(formData, "preview_token");
  const planHash = legacyImportStringField(formData, "plan_hash");
  if (!previewToken || !planHash) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        message: "先にプレビューを実行してください。",
        requires_repreview: true,
      },
    };
  }
  return { ok: true, previewToken, planHash };
}
