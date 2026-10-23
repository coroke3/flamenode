import { z } from "zod";
import { OnboardingStateSchema, PersonalUserSchema } from "./shared.ts";

// CURRENT: app/(auth)/onboarding/page.tsx

export const OnboardingRulesSchema = z.object({
  versionLabel: z.string(),
  bodyMarkdown: z.string(),
});

export const OnboardingResponseSchema = z.object({
  user: PersonalUserSchema,
  state: OnboardingStateSchema,
  /**
   * Only present when state.needsTermsAcceptance. null = no published rules found:
   * the client falls back to DEFAULT_TERMS_MARKDOWN / DEFAULT_TERMS_VERSION_LABEL like CURRENT.
   */
  rules: OnboardingRulesSchema.nullable(),
});

export type OnboardingRules = z.infer<typeof OnboardingRulesSchema>;
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;
