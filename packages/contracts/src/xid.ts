import { z } from "zod";

/** MIG-0636 SA-098. JSON transport of CURRENT FormData[x_user_id]. */
export const SetActiveXBodySchema = z.object({
  x_user_id: z.string(),
});

export const XIdWriteResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  reason: z.string().optional(),
});

export type XIdWriteResult = z.infer<typeof XIdWriteResultSchema>;

/** MIG-0636 U05 / SA-102: JSON transport of CURRENT updateXIdProfile FormData.
 * Optional keys have CURRENT's empty-string default, not a claim that the
 * profile mutation endpoint is implemented or authorized yet.
 */
export const UpdateXIdProfileBodySchema = z.object({
  x_user_id: z.string(),
  x_name: z.string().optional(),
  profile_text: z.string().optional(),
  portfolio_contact: z.string().optional(),
  youtube_channel_url: z.string().optional(),
  other_social_links: z.string().optional(),
});

/** MIG-0636 U05 / SA-103: CURRENT requires an exact "DELETE <normalized X ID>" confirmation. */
export const DeleteLinkedXIdBodySchema = z.object({
  x_user_id: z.string(),
  confirm: z.string(),
});

/** MIG-0636 U05 / SA-104: icon_url is a candidate selector, not an arbitrary external URL.
 * The eventual route MUST recheck the linked and approved identity and the
 * server-side icon candidate list before any write.
 */
export const SetXIdIconBodySchema = z.object({
  x_user_id: z.string(),
  icon_url: z.string(),
});

export type UpdateXIdProfileBody = z.infer<typeof UpdateXIdProfileBodySchema>;
export type DeleteLinkedXIdBody = z.infer<typeof DeleteLinkedXIdBodySchema>;
export type SetXIdIconBody = z.infer<typeof SetXIdIconBodySchema>;
