import * as React from "react";
import type { ChapterItem } from "@flamenode/contracts";
import { AppLink } from "./AppLink.js";
import { formatRelative } from "./format.js";

/** Chapter comment rows, identical markup in CURRENT dashboard/page.tsx and dashboard/library/page.tsx. */
export function ChapterItems({ chapters }: { chapters: readonly ChapterItem[] }): React.ReactElement {
  return (
    <div className="fn-stack-list">
      {chapters.map((chapter) => (
        <AppLink
          key={chapter.id}
          href={`/${chapter.youtube_video_id?.trim() || chapter.video_id}`}
          className="fn-card fn-stack-item"
        >
          <div className="fn-stack-item-head">
            <strong className="fn-stack-item-title">{chapter.chapter_label}</strong>
            <span
              className={`fn-badge ${chapter.visibility === "private" ? "fn-badge-warning" : "fn-badge-accent"}`}
            >
              {chapter.visibility === "private" ? "非公開" : "公開"}
            </span>
          </div>
          <div className="fn-stack-item-meta">
            {chapter.video_title ?? chapter.video_id} / {Math.floor(chapter.chapter_time)}秒 /{" "}
            {formatRelative(chapter.created_at)}
          </div>
        </AppLink>
      ))}
    </div>
  );
}
