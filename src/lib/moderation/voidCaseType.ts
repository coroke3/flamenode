import type { ModerationCaseType } from "@/lib/admin/moderationCaseInput";

/** admin void_reason_category → moderation case_type */
export function resolveVoidModerationCaseType(
  category: string,
): ModerationCaseType {
  const normalized = category.trim();
  if (normalized === "duplicate") return "duplicate";
  if (normalized === "x_id_invalid") return "x_reapply";
  return "void";
}
