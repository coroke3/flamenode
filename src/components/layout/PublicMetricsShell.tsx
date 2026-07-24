import * as React from "react";
import { runWithPublicRequestMetrics } from "@/lib/observability/publicRequestMetrics";
import { PublicDegradedBanner } from "@/components/layout/PublicDegradedBanner";

export async function PublicMetricsShell({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  return (await runWithPublicRequestMetrics(
    "/",
    async () => (
      <>
        {children}
        <PublicDegradedBanner />
      </>
    ),
  )) as React.ReactElement;
}
