import { z } from "zod";
import type { SaveEventTemplateInput } from "./types.ts";

export const saveEventTemplateSchema = z.object({
  event_id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export function validateSaveEventTemplateInput(
  raw: Record<string, unknown>,
): { ok: true; data: SaveEventTemplateInput } | { ok: false; message: string } {
  const parsed = saveEventTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  return {
    ok: true,
    data: {
      event_id: parsed.data.event_id,
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
    },
  };
}

export function validateDeleteEventTemplateId(
  templateId: string | null | undefined,
): { ok: true; templateId: string } | { ok: false; message: string } {
  const trimmed = String(templateId ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "template_id が必要です。" };
  }
  return { ok: true, templateId: trimmed };
}
