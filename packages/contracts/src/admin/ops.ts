import { z } from "zod";

/** MIG-0637 SA-016..020, 077..081. Keep legacy FormData key names for D-16-1. */
export const AdminOpsResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  warning: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
});
export type AdminOpsResult = z.infer<typeof AdminOpsResultSchema>;
/** Zod unknown() accepts absent properties. Require legacy FormData keys,
 * while preserving the domain validators' original error messages. */
const present = z.unknown().refine((value) => value !== undefined);

export const CostGuardModeBodySchema = z.object({ mode: present, reason: present });
export const CostGuardMaintenanceBodySchema = z.object({ is_maintenance_mode: present, reason: present });
export const CostGuardOverrideBodySchema = z.object({ reason: present, confirm: present, features: z.array(z.unknown()) });
export const CostGuardDisabledBodySchema = CostGuardOverrideBodySchema.extend({
  expected_disabled_features_json: present,
});
export const CostGuardClearBodySchema = z.object({ reason: present, confirm: present });
export const AdminUserRoleBodySchema = z.object({ role: present });
export const AdminUserBanBodySchema = z.object({ is_banned: present, reason: present.optional() });
export const AdminUserNotificationsBodySchema = z.object({ is_notification_enabled: present });
export const AdminUserEventCreateBodySchema = z.object({ can_create_events: present });
export const AdminXIconRefreshBodySchema = z.object({}).strict();
