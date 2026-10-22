import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { PersonalApi } from "../api/session.js";
import { SessionGate } from "./guard.js";
import { onboardingHref, sanitizeOnboardingNext } from "./next.js";
import { PendingData } from "./pending.js";

/**
 * CURRENT app/(auth)/onboarding/page.tsx: guard `next` is the sanitized self href.
 * Terms / X-ID step data (getOnboardingState, rules) is blocker B1; the
 * maybeMarkOnboardingComplete write belongs to MIG-0702.
 */
export function Onboarding({ api }: { api: PersonalApi }): React.ReactElement {
  const [params] = useSearchParams();
  const next = sanitizeOnboardingNext(params.get("next"), "/dashboard");
  return (
    <SessionGate api={api} next={onboardingHref(next)}>
      {() => <PendingData title="初期設定" endpoint="GET onboarding state" />}
    </SessionGate>
  );
}
