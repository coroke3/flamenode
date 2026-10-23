import type { DB } from "@/lib/db/client";
import { getCollaboratorPermissions } from "@/lib/auth/ownership";
import {
  adminEventEditPermissions,
  delegatedEventEditPermissions,
  type EventEditPermissions,
} from "@flamenode/domain/event";

export { hasAnyEventEditPermission } from "@flamenode/domain/event";

/** DB adapter: reads the actor's event staff grant, then applies the domain section policy. */
export async function resolveEventEditPermissions(
  db: DB,
  user: { id: string; role?: string | null },
  eventId: string,
): Promise<EventEditPermissions> {
  if (user.role === "admin") {
    return adminEventEditPermissions();
  }
  const permissions = await getCollaboratorPermissions(db, user.id, eventId);
  return delegatedEventEditPermissions(permissions);
}
