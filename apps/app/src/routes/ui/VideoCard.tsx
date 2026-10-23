import * as React from "react";
import type { VideoCard as VideoCardData } from "@flamenode/contracts";
import { AppLink } from "./AppLink.js";
import { Icon } from "./Icon.js";
import { cachedGoogleImageUrl, youtubeThumbUrl } from "./media.js";

/**
 * Port of CURRENT src/components/video/VideoCard.tsx (default size, explicit href only: the dashboard and
 * library always pass one). CSS-module classes (card/thumbWrap/thumb/thumbFallback/statusBadge) keep their
 * names as plain `vcard-*` classes until the stylesheet port lands.
 */
export function VideoCard({ video, href }: { video: VideoCardData; href: string }): React.ReactElement {
  const thumb = youtubeThumbUrl(video.youtube_video_id, "mqdefault");
  const creatorIcon = cachedGoogleImageUrl(video.icon_url);
  return (
    <AppLink href={href} className="fn-vcard vcard-card">
      <div className="fn-thumb vcard-thumbWrap">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="vcard-thumb" />
        ) : (
          <div className="vcard-thumbFallback">
            <Icon name="youtube" size={28} aria-hidden />
          </div>
        )}
        <span className="fn-thumb-grid" aria-hidden />
        {video.status === "private" ? (
          <span className="fn-badge fn-badge-soft vcard-statusBadge">非公開</span>
        ) : video.status === "voided" ? (
          <span className="fn-badge fn-badge-neutral vcard-statusBadge">無効</span>
        ) : null}
      </div>
      <div className="fn-vcard-body">
        <h3 className="fn-vcard-title">{video.title}</h3>
        <div className="fn-vcard-meta">
          <div className="fn-vcard-creator">
            <span className="fn-vcard-avatar">
              {creatorIcon ? (
                <img src={creatorIcon} alt="" loading="lazy" />
              ) : (
                <Icon name="user" size={10} aria-hidden />
              )}
            </span>
            <span>{video.display_name}</span>
          </div>
        </div>
      </div>
    </AppLink>
  );
}
