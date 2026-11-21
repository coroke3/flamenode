/**
 * MIG-0651 SA-086: UNMOUNTED HTTP input transport candidate.
 *
 * This is NOT an authenticated or persistence-ready video submission route.
 * Caller MUST run: origin -> session -> writeGuard(CostGuard + approved Active X)
 * -> limitVideoActionBody("SA-086"), then canonical video form parse, and only
 * then invoke this helper with trusted {activeXId,isCollab,nowSec}.
 *
 * It performs no DB reads, R2 uploads, Queue work, mutations or post-commit
 * wake. Do not mount a POST route until all S3 parity/CPU and Lead gates pass.
 */
import { validateFreeVideoMultipartPreflight, type FreeVideoPreflightContext } from "@flamenode/domain/video";
import type { Context } from "hono";
import type { AppEnv } from "../../env.ts";

const BAD_FORM_MESSAGE = "投稿フォームの入力が不正です。";

/** Parse exactly the multipart/urlencoded form transport, without first/last
 * key collapsing. FormData is fed to the shared duplicate-keys and identity
 * checks; malformed encoding/file boundaries fail closed before a write plan.
 * Bytes are bounded by the caller's limitVideoActionBody middleware.
 */
export async function readFreeVideoMultipartPreflight(
  c: Context<AppEnv>,
  trustedContext: FreeVideoPreflightContext,
): Promise<ReturnType<typeof validateFreeVideoMultipartPreflight>> {
  const contentType = c.req.header("content-type")?.trim() ?? "";
  if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, message: BAD_FORM_MESSAGE };
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return { ok: false, message: BAD_FORM_MESSAGE };
  }
  return validateFreeVideoMultipartPreflight(formData, trustedContext);
}
