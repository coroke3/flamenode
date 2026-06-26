"use client";

import * as React from "react";
import { VideoStatusForm } from "@/components/video/VideoStatusForm";
import { setVideoStatus } from "@/lib/actions/admin";

interface AdminVideoStatusFormProps {
  videoId: string;
  currentStatus: string;
}

const STATUS_VALUES = [
  "draft",
  "pending",
  "public",
  "limited",
  "private",
  "hidden",
  "archived",
  "voided",
] as const;

export function AdminVideoStatusForm({
  videoId,
  currentStatus,
}: AdminVideoStatusFormProps): React.ReactElement {
  return (
    <VideoStatusForm
      videoId={videoId}
      currentStatus={currentStatus}
      statuses={STATUS_VALUES}
      action={setVideoStatus}
      formIdPrefix="admin-video"
      statusLabel="変更先ステータス"
      submitLabel="適用"
      optionDescription
      allowVoidReason
      showMessageIcons
    />
  );
}
