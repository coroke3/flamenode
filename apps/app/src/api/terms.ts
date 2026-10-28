// MIG-0710 U02: provisional JSON contract until MIG-0641 is merged (D-16-1).
import { send, type FetchLike, type WriteResult } from "./write.js";

export type TermsAcceptResponse = { ok: boolean; message?: string };
export type TermsApi = {
  accept(): Promise<WriteResult<TermsAcceptResponse>>;
};

export function createTermsApi(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): TermsApi {
  return {
    accept: () => send<TermsAcceptResponse>(fetchFn, "POST", "/api/personal/onboarding/terms", {}),
  };
}
