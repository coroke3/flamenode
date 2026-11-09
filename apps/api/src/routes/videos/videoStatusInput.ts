/**
 * MIG-0603 U02a-2: unmounted HTTP input boundary for video visibility changes.
 *
 * This parser does no I/O except bounded request-body reads. It is intentionally
 * NOT registered in an active Hono router: permission checks, CAS, audit,
 * visibility fences, notifications and rebuild side effects are not yet ported.
 *
 * Parse order for a future route: origin -> session -> identity / CostGuard ->
 * bounded JSON -> transport normalization -> CURRENT domain validation.
 */
import {
  AdminVideoStatusBodySchema,
  ManageVideoStatusBodySchema,
  normalizeAdminVideoStatusBody,
  normalizeManageVideoStatusBody,
} from "@flamenode/contracts";
import {
  validateAdminVideoStatusInput,
  validateManageVideoStatusInput,
} from "@flamenode/domain/video";
import { BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";

export type VideoStatusInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; status: 400 | 413; message: string };

const INVALID_INPUT_MESSAGE = "入力が不正です。";

function invalid(status: 400 | 413, message = INVALID_INPUT_MESSAGE) {
  return { ok: false as const, status, message };
}

/**
 * Only the JSON shape and CURRENT domain rules are checked here.
 * NEVER use a successful result as evidence of authorization to mutate D1.
 */
export async function parseAdminVideoStatusInput(request: Request) {
  const body = await readAdminJsonBody(request);
  if (body.kind === "too_large") return invalid(413, BODY_TOO_LARGE_MESSAGE);
  if (body.kind !== "ok") return invalid(400);
  const parsed = AdminVideoStatusBodySchema.safeParse(body.value);
  if (!parsed.success) return invalid(400);
  const input = normalizeAdminVideoStatusBody(parsed.data);
  const validation = validateAdminVideoStatusInput(input);
  if (!validation.ok) return invalid(400, validation.message);
  return { ok: true as const, input };
}

export async function parseManageVideoStatusInput(request: Request) {
  const body = await readAdminJsonBody(request);
  if (body.kind === "too_large") return invalid(413, BODY_TOO_LARGE_MESSAGE);
  if (body.kind !== "ok") return invalid(400);
  const parsed = ManageVideoStatusBodySchema.safeParse(body.value);
  if (!parsed.success) return invalid(400);
  const input = normalizeManageVideoStatusBody(parsed.data);
  const validation = validateManageVideoStatusInput(input);
  if (!validation.ok) return invalid(400, validation.message);
  return { ok: true as const, input };
}
