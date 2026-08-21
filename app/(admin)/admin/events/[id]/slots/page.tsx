import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "枠運営" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventSlotsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  redirect(`/manage/events/${encodeURIComponent(id)}/slots`);
}
