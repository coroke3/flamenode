// MIG-0710 U02/U04: final merged MIG-0641 onboarding write-response contracts.
import {
  OnboardingTermsAcceptResponseSchema,
  OnboardingCompleteResponseSchema,
  type OnboardingTermsAcceptResponse,
  type OnboardingCompleteResponse,
} from "@flamenode/contracts";
import { send, type FetchLike, type WriteResult } from "./write.js";

export type TermsAcceptResponse = OnboardingTermsAcceptResponse;
export type TermsApi = {
  accept(): Promise<WriteResult<TermsAcceptResponse>>;
  complete(): Promise<WriteResult<OnboardingCompleteResponse>>;
};

/** A well-formed transport envelope is not sufficient: validate each API's actual DTO. */
async function validate<T extends { ok: boolean }>(
  request: Promise<WriteResult<{ ok: boolean }>>,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<WriteResult<T>> {
  const result = await request;
  if (result.status !== "ok") return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success && parsed.data
    ? { status: "ok", data: parsed.data }
    : { status: "unavailable" };
}

export function createTermsApi(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): TermsApi {
  return {
    accept: () => validate(
      send(fetchFn, "POST", "/api/personal/onboarding/terms", {}),
      OnboardingTermsAcceptResponseSchema,
    ),
    complete: () => validate(
      send(fetchFn, "POST", "/api/personal/onboarding/complete", {}),
      OnboardingCompleteResponseSchema,
    ),
  };
}
