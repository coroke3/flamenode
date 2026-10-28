import { z } from "zod";

/**
 * MIG-0641 U01a: Personal write transport contracts (D-16-1).
 * CURRENT SA-075 accepts the next field; the Hono handler must sanitize it
 * with CURRENT sanitizeNextPath before returning the navigation target.
 * DTOs do not grant authorization or mutate the database.
 */
export const AcceptLatestTermsBodySchema = z.object({
  next: z.string().optional(),
});
export const AcceptLatestTermsResponseSchema = z.object({
  ok: z.boolean(),
  next: z.string(),
  message: z.string().optional(),
});
export type AcceptLatestTermsBody = z.infer<typeof AcceptLatestTermsBodySchema>;
export type AcceptLatestTermsResponse = z.infer<typeof AcceptLatestTermsResponseSchema>;

/** CURRENT acceptOnboardingTerms() is a success-or-message union. */
export const OnboardingTermsAcceptResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), alreadyAccepted: z.boolean().optional() }),
  z.object({ ok: z.literal(false), message: z.string(), retryable: z.boolean().optional() }),
]);
export type OnboardingTermsAcceptResponse = z.infer<typeof OnboardingTermsAcceptResponseSchema>;

/** Completion marker is optional accounting, never a login/role/access grant. */
export const OnboardingCompleteResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type OnboardingCompleteResponse = z.infer<typeof OnboardingCompleteResponseSchema>;
