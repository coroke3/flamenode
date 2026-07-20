import "server-only";

import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { eventStaff } from "@/lib/db/schema";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import {
  PRESET_DEFINITIONS,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";
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
  displayName: string | null;
  preset: EventStaffPreset | null;
  presetLabel: string | null;
  resolvedKeys: PermissionKey[];
  resolvedLabels: string[];
  spotlight: Array<{ key: PermissionKey; label: string; allowed: boolean }>;
};

export async function simulateEventPermissions(
  db: DB,
  input: { eventId: string; xUserId: string },
): Promise<PermissionSimulationResult> {
  const eventId = input.eventId.trim();
  const xUserId = input.xUserId.trim().replace(/^@/, "") || null;

  const empty: PermissionSimulationResult = {
    found: false,
    eventId,
    xUserId,
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

  if (!eventId || !xUserId) return empty;

  const row = (
    await db
      .select()
      .from(eventStaff)
      .where(
        and(
          eq(eventStaff.event_id, eventId),
          eq(eventStaff.x_user_id, xUserId),
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
