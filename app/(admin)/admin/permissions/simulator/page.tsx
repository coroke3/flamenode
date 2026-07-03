import * as React from "react";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/cloudflare";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PermissionSimulatorPanel } from "@/components/admin/PermissionSimulatorPanel";
import { simulateEventPermissions } from "@/lib/admin/permissionSimulator";

export const metadata: Metadata = { title: "権限シミュレーター" };
export const dynamic = "force-dynamic";

export default async function PermissionSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{
    event_id?: string;
    x_user_id?: string;
    discord_user_id?: string;
  }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const eventId = (sp.event_id ?? "").trim();
  const xUserId = (sp.x_user_id ?? "").trim();
  const discordUserId = (sp.discord_user_id ?? "").trim();

  const db = getDatabase();
  const result =
    db && eventId && (xUserId || discordUserId)
      ? await simulateEventPermissions(db, {
          eventId,
          xUserId: xUserId || undefined,
          discordUserId: discordUserId || undefined,
        })
      : null;

  return (
    <div>
      <AdminPageHeader
        title="権限シミュレーター"
        description="イベントスタッフの permission_mask / プリセットを、X ID または Discord ID から確認します。"
      />
      <PermissionSimulatorPanel
        eventId={eventId}
        xUserId={xUserId}
        discordUserId={discordUserId}
        result={result}
      />
    </div>
  );
}
