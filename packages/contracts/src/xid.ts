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
