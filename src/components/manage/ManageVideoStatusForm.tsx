"use client";

import * as React from "react";
import { VideoStatusForm } from "@/components/video/VideoStatusForm";
import { setManageVideoStatus } from "@/lib/actions/manage-video";

const MANAGE_STATUS_VALUES = [
  "pending",
  "public",
  "hidden",
  "private",
  "limited",
  "draft",
] as const;

interface ManageVideoStatusFormProps {
  eventId: string;
  videoId: string;
  currentStatus: string;
}

export function ManageVideoStatusForm({
  eventId,
  videoId,
  currentStatus,
}: ManageVideoStatusFormProps): React.ReactElement {
  return (
    <VideoStatusForm
      videoId={videoId}
      currentStatus={currentStatus}
      statuses={MANAGE_STATUS_VALUES}
      action={setManageVideoStatus}
      formIdPrefix={`manage-video-${videoId}`}
      statusLabel="公開状態を変更"
      submitLabel="審査結果を保存"
      hiddenFields={{ event_id: eventId }}
    />
  );
}
