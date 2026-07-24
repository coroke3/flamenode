import * as React from "react";
import { runWithPublicRequestMetrics } from "@/lib/observability/publicRequestMetrics";

export async function PublicMetricsShell({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  return (await runWithPublicRequestMetrics(
    "public",
    async () => children,
  )) as React.ReactElement;
}
