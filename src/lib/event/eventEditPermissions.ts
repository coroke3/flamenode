import type { DB } from "@/lib/db/client";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import { expandPermissionAliases } from "@/lib/auth/permissions/aliases";
import type { EventEditPermissions } from "@/lib/event/eventPayload";

const SECTION_KEYS = {
  basic: "event.basic",
  publish: "event.publish",
  questions: "event.questions",
  slots: "event.slots",
} as const;

function sectionAllowed(
  permissions: Set<string>,
  requiredKey: string,
): boolean {
  return expandPermissionAliases(requiredKey).some((key) => permissions.has(key));
}

export async function resolveEventEditPermissions(
  db: DB,
  user: { id: string; role?: string | null },
  eventId: string,
): Promise<EventEditPermissions> {
  if (user.role === "admin") {
    return { basic: true, publish: true, questions: true, slots: true };
  }
  const permissions = await getCollaboratorPermissions(db, user.id, eventId);
  return {
    basic: sectionAllowed(permissions, SECTION_KEYS.basic),
    publish: sectionAllowed(permissions, SECTION_KEYS.publish),
    questions: sectionAllowed(permissions, SECTION_KEYS.questions),
    slots: sectionAllowed(permissions, SECTION_KEYS.slots),
  };
}

export function hasAnyEventEditPermission(permissions: EventEditPermissions): boolean {
  return (
    permissions.basic ||
    permissions.publish ||
    permissions.questions ||
    permissions.slots
  );
}
