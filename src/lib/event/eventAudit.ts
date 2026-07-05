import type { DB } from "@/lib/db/client";
import { auditAction } from "@/lib/audit/helpers";
import { buildEventUpdateAuditPayload } from "@/lib/admin/eventSectionFields";
import type { events } from "@/lib/db/schema";
import type { EventEditSection } from "@/lib/admin/eventSectionFields";
import type { EventUpdatePayload } from "@/lib/event/eventPayload";

export async function writeEventUpdateAudit(args: {
  db: DB;
  eventId: string;
  operatorUserId: string;
  updatedSections: EventEditSection[];
  changedByPermission: Record<EventEditSection, string>;
  before: typeof events.$inferSelect;
  afterPayload: EventUpdatePayload;
}): Promise<void> {
  const audit = buildEventUpdateAuditPayload({
    updatedSections: args.updatedSections,
    changedByPermission: args.changedByPermission,
    before: args.before,
    afterPayload: args.afterPayload,
  });
  await auditAction(args.db, {
    table_name: "events",
    record_id: args.eventId,
    action: "UPDATE",
    before_data: audit.before_data,
    after_data: audit.after_data,
    operator_discord_id: args.operatorUserId,
    retention_class: "normal",
  });
}
