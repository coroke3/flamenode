import type { ServerCoreDb } from "../db.ts";
import { getCollaboratorPermissions } from "../auth/ownership.ts";
import {
  adminEventEditPermissions,
  delegatedEventEditPermissions,
  type EventEditPermissions,
} from "@flamenode/domain/event";

/** DB adapter: reads the actor's event staff grant, then applies the domain section policy. */
export async function resolveEventEditPermissions(
  db: ServerCoreDb,
  user: { id: string; role?: string | null },
  eventId: string,
): Promise<EventEditPermissions> {
  if (user.role === "admin") {
    return adminEventEditPermissions();
  }
  const permissions = await getCollaboratorPermissions(db, user.id, eventId);
  return delegatedEventEditPermissions(permissions);
}
