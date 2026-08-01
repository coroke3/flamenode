import * as React from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { PublicMetricsShell } from "@/components/layout/PublicMetricsShell";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div data-fn-surface="public" className="fn-public-shell fn-app">
      {gaMeasurementId ? <GoogleAnalytics gaId={gaMeasurementId} /> : null}
      {/* source省略 = KV/envのみ。D1のsystem_settingsは読まない。 */}
      <CostGuardBanner />
      <PublicHeader />
      <main
        className="fn-main flex-1 w-full"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <PublicMetricsShell>{children}</PublicMetricsShell>
      </main>
      <PublicFooter />
    </div>
  );
}
