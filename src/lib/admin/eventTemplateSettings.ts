/** Next compatibility bridge: snapshot semantics are owned by @flamenode/domain/eventTemplates (MIG-0655). */
import type { events } from "@/lib/db/schema";

// Keep the original DB row alias for callers that depend on Drizzle's schema type.
export type EventRow = typeof events.$inferSelect;
export {
  normalizeTemplateQuestionDefinitions,
  snapshotFromEvent,
  parseEventTemplateSnapshot,
  snapshotToFormInitial,
} from "@flamenode/domain/eventTemplates";
export type {
  EventTemplateQuestionRow,
  EventTemplateQuestionDefinition,
  EventTemplateSnapshot,
} from "@flamenode/domain/eventTemplates";
