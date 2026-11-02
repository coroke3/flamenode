import { z } from "zod";

/**
 * MIG-0642 SA-045..049, SA-051..055 (D-17-4). Request bodies keep the CURRENT
 * FormData key names (D-16-1); ids that CURRENT carried in a hidden field are
 * path parameters here and are never read from the body. Value validation is
 * left to the shared domain validators so their original messages survive.
 */
export const AdminTermsNotificationsResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  id: z.string().optional(),
  retried: z.number().optional(),
  enqueued: z.number().optional(),
  cursor: z.string().optional(),
  warning: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
  settings: z
    .object({
      default_editable_fields: z.string().nullable(),
      upcoming_editable_fields: z.string().nullable(),
    })
    .optional(),
});
export type AdminTermsNotificationsResult = z.infer<
  typeof AdminTermsNotificationsResultSchema
>;

/** SA-051 (POST body) / SA-052 (PATCH body; the path id wins over `id`). */
export const AdminTermsDraftBodySchema = z.object({
  id: z.unknown().optional(),
  version_label: z.unknown().optional(),
  body_markdown: z.unknown().optional(),
  severity: z.unknown().optional(),
});

/** SA-054; `terms_id` is the path id. */
export const AdminTermsReacceptBroadcastBodySchema = z.object({
  confirm: z.unknown().optional(),
  cursor: z.unknown().optional(),
  content: z.unknown().optional(),
});

/** SA-049: CURRENT read both lists with FormData.getAll(). */
export const AdminEditableFieldsBodySchema = z.object({
  default_editable_fields: z.array(z.string()).optional(),
  upcoming_editable_fields: z.array(z.string()).optional(),
});

/** SA-046; `id` is the path id. The body may be omitted entirely. */
export const AdminNotificationCancelBodySchema = z.object({
  reason: z.unknown().optional(),
});
