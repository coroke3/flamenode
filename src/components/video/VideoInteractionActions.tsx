"use client";

import * as React from "react";
import { InteractionButton } from "./InteractionButton";
import { useVideoViewerOverlay } from "@/lib/video/videoViewerOverlayClient";

export function VideoInteractionActions({
  videoId,
  currentPath,
  likeCount,
}: {
  videoId: string;
  currentPath: string;
  likeCount: number;
}): React.ReactElement {
  const { overlay, loading } = useVideoViewerOverlay(videoId);
  const needsTermsAcceptance =
    overlay.loggedIn &&
    (!overlay.isTosAccepted || overlay.termsReacceptRequired);
  const canInteract =
    overlay.loggedIn &&
    !overlay.isBanned &&
    !needsTermsAcceptance &&
    !overlay.authUnavailable;

  const loginHref = `/entry?next=${encodeURIComponent(currentPath)}`;
  const rulesHref = `/rules?next=${encodeURIComponent(currentPath)}`;

  let disabledReason: string | undefined;
  let actionHref: string | undefined;
  if (loading) {
    disabledReason = "ログイン状態を確認中です。";
  } else if (overlay.authUnavailable) {
    disabledReason =
      "ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。";
  } else if (!overlay.loggedIn) {
    disabledReason = "ログインするといいね、セーブができます。";
    actionHref = loginHref;
  } else if (overlay.isBanned) {
    disabledReason = "現在、このアカウントは利用停止中です。";
  } else if (needsTermsAcceptance) {
    disabledReason = "利用規約に同意するといいね、セーブができます。";
    actionHref = rulesHref;
  }

  return (
    <>
      <InteractionButton
        videoId={videoId}
        kind="like"
        initialActive={overlay.likeActive}
        count={likeCount}
        canInteract={canInteract}
        disabledReason={disabledReason}
        actionHref={actionHref}
      />
      <InteractionButton
        videoId={videoId}
        kind="bookmark"
        initialActive={overlay.bookmarkActive}
        canInteract={canInteract}
        disabledReason={disabledReason}
        actionHref={actionHref}
      />
    </>
  );
}
