import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "イベント管理者を登録/編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventStaffPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  redirect(`/manage/events/${id}/staff`);
}
