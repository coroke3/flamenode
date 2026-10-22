import { z } from "zod";

export const SoftwareSuggestionDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  usage_count: z.number(),
  is_verified: z.number(),
});

export type SoftwareSuggestionDto = z.infer<typeof SoftwareSuggestionDtoSchema>;
