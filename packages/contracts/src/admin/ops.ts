import { z } from "zod";

/** MIG-0637 SA-016..020, 077..081. Keep legacy FormData key names for D-16-1. */
export const AdminOpsResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  warning: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
});
export type AdminOpsResult = z.infer<typeof AdminOpsResultSchema>;
export const CostGuardModeBodySchema = z.object({ mode: z.unknown(), reason: z.unknown() });
export const CostGuardMaintenanceBodySchema = z.object({ is_maintenance_mode: z.unknown(), reason: z.unknown() });
export const CostGuardOverrideBodySchema = z.object({ reason: z.unknown(), confirm: z.unknown(), features: z.array(z.unknown()) });
export const CostGuardDisabledBodySchema = CostGuardOverrideBodySchema.extend({
  expected_disabled_features_json: z.unknown(),
});
export const CostGuardClearBodySchema = z.object({ reason: z.unknown(), confirm: z.unknown() });
export const AdminUserRoleBodySchema = z.object({ role: z.unknown() });
export const AdminUserBanBodySchema = z.object({ is_banned: z.unknown(), reason: z.unknown().optional() });
export const AdminUserNotificationsBodySchema = z.object({ is_notification_enabled: z.unknown() });
export const AdminUserEventCreateBodySchema = z.object({ can_create_events: z.unknown() });
export const AdminXIconRefreshBodySchema = z.object({}).strict();
