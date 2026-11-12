/** MIG-0720 U05 / SA-035: saveEventAsTemplate client (POST /api/admin/event-templates). */
import {
  type EventTemplateActionResult,
  type SaveEventTemplateInput,
  validateSaveEventTemplateInput,
} from "@flamenode/domain/eventTemplates";
import type { OpsFetch } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

export type SaveEventTemplateOutcome = OpsWriteResult<EventTemplateActionResult>;

function isValidTemplateResult(value: unknown): value is EventTemplateActionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean") return false;
  if (record.message !== undefined && typeof record.message !== "string") return false;
  if (record.templateId !== undefined && typeof record.templateId !== "string") return false;
  return true;
}

/**
 * Validates input with @flamenode/domain/eventTemplates and sends POST /api/admin/event-templates.
 * Hono remains the sole authority for admin identity, ToS, CostGuard, event lookup and strict audit.
 */
export async function saveEventAsTemplate(
  fetchFn: OpsFetch,
  raw: SaveEventTemplateInput,
): Promise<SaveEventTemplateOutcome> {
  const validated = validateSaveEventTemplateInput({
    event_id: raw.event_id,
    name: raw.name,
    description: raw.description ?? null,
  });
  if (!validated.ok) {
    return { status: "ok", data: { ok: false, message: validated.message } };
  }

  let httpStatus: number | null = null;
  const result = await send<EventTemplateActionResult>(
    async (path, init) => {
      const response = await fetchFn(path, init);
      httpStatus = response.status;
      return response;
    },
    "POST",
    "/api/admin/event-templates",
    validated.data,
  );
  if (httpStatus === 401) return { status: "anonymous" };
  if (httpStatus === null || result.status !== "ok" || !isValidTemplateResult(result.data)) {
    return { status: "unavailable" };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return result.data.ok ? result : { status: "unavailable" };
  }
  if ([400, 403, 404, 409, 413, 422, 500, 503].includes(httpStatus) && result.data.ok === false) {
    return result;
  }
  return { status: "unavailable" };
}
