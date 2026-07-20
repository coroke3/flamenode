import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { eventStaff, xUserAccountLinks } from "@/lib/db/schema";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import { PRESET_DEFINITIONS, type EventStaffPreset } from "@/lib/auth/permissions/presets";
import { formatPermissionKeyLabel } from "@/lib/admin/permissionIntegrityChecks";
import type { PermissionKey } from "@/lib/auth/permissions/keys";

const SPOTLIGHT_KEYS: PermissionKey[] = [
  "event.basic",
  "event.slots",
  "event.review",
  "event.members",
  "video.status",
  "video.descriptions",
  "event.notifications",
];

export type PermissionSimulationResult = {
  found: boolean;
  eventId: string;
  xUserId: string | null;
  userId: string | null;
  displayName: string | null;
  preset: EventStaffPreset | null;
  presetLabel: string | null;
  resolvedKeys: PermissionKey[];
  resolvedLabels: string[];
  spotlight: Array<{ key: PermissionKey; label: string; allowed: boolean }>;
};

export async function simulateEventPermissions(
  db: DB,
  input: {
    eventId: string;
    xUserId?: string;
    userId?: string;
  },
): Promise<PermissionSimulationResult> {
  const eventId = input.eventId.trim();
  const xUserId = input.xUserId?.trim().replace(/^@/, "") || null;
  const userId = input.userId?.trim() || null;

  const empty: PermissionSimulationResult = {
    found: false,
    eventId,
    xUserId,
    userId,
    displayName: null,
    preset: null,
    presetLabel: null,
    resolvedKeys: [],
    resolvedLabels: [],
    spotlight: SPOTLIGHT_KEYS.map((key) => ({
      key,
      label: formatPermissionKeyLabel(key),
      allowed: false,
    })),
  };

  if (!eventId || (!xUserId && !userId)) return empty;

  const subjectXIds = xUserId
    ? [xUserId]
    : (
        await db
          .select({ x_user_id: xUserAccountLinks.x_user_id })
          .from(xUserAccountLinks)
          .where(eq(xUserAccountLinks.auth_user_id, userId!))
      ).map((row) => row.x_user_id);
  if (subjectXIds.length === 0) return empty;

  const row = (
    await db
      .select()
      .from(eventStaff)
      .where(
        and(
          eq(eventStaff.event_id, eventId),
          inArray(eventStaff.x_user_id, subjectXIds),
        )!,
      )
      .limit(1)
  )[0];

  if (!row) return empty;

  const preset = (row.permission_preset ?? "public_staff") as EventStaffPreset;
  const resolved = resolveStaffPermissionKeys(row);
  const resolvedKeys = [...resolved].sort();

  return {
    found: true,
    eventId,
    xUserId: row.x_user_id,
    userId,
    displayName: row.display_name,
    preset,
    presetLabel: PRESET_DEFINITIONS[preset]?.label ?? preset,
    resolvedKeys,
    resolvedLabels: listResolvedPermissionLabels(resolvedKeys),
    spotlight: SPOTLIGHT_KEYS.map((key) => ({
      key,
      label: formatPermissionKeyLabel(key),
      allowed: resolved.has(key),
    })),
  };
}

export function listResolvedPermissionLabels(keys: PermissionKey[]): string[] {
  return keys.map((key) => formatPermissionKeyLabel(key));
}
