import React from "react";
import { Image, Link } from "../adapters/index.js";

/*
 * Small pieces shared by the representative screens (MIG-0205). Markup follows the
 * registered mock (`docs/migration/mock/static/*.html`); styles are in `styles/screens.css`.
 * The mock draws Font Awesome icons; the project has no icon font, so the few icons the
 * screens need are inline SVG strokes (same approach as the MIG-0203 header).
 */
const ICON_PATHS = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0",
  x: "M4 4h4.5L20 20h-4.5zM19.5 4l-6.2 7M4.5 20l6.2-7",
  youtube: "M3 7.5C3 6 4 5 5.5 5h13C20 5 21 6 21 7.5v9c0 1.5-1 2.5-2.5 2.5h-13C4 19 3 18 3 16.5zM10 9v6l5-3z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  software: "M4 5h16v11H4zM8 20h8M12 16v4",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 6l-6 6 6 6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5v-5m0-3h.01",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  idCard: "M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 16c.5-2 2-3 3-3s2.5 1 3 3M14 9h4M14 13h4",
  group: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 19a6 6 0 0 0-4-5.6",
  comment: "M4 5h16v11H9l-5 4z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.5-4.5",
  sort: "M4 6h13M4 12h9M4 18h5M19 5v14m0 0-3-3m3 3 3-3",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
} as const;

export type ScreenIconName = keyof typeof ICON_PATHS;

export function ScreenIcon({ name }: { name: ScreenIconName }): React.ReactElement {
  return (
    <svg className="scr-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Round avatar from the mock (`img.avatar`); a neutral placeholder when there is no icon. */
export function Avatar({
  src,
  size,
  className,
}: {
  src?: string | null;
  size: number;
  className?: string;
}): React.ReactElement {
  const cls = className ? `avatar ${className}` : "avatar";
  if (src) {
    return <Image className={cls} src={src} alt="" width={size} height={size} />;
  }
  return (
    <span className={`${cls} avatar--empty`} aria-hidden="true" style={{ width: size, height: size }}>
      <ScreenIcon name="user" />
    </span>
  );
}

export interface ScreenVideoCard {
  /** Destination chosen by the caller (CURRENT builds it from the YouTube ID or internal ID). */
  href: string;
  title: string;
  thumbnailUrl?: string | null;
  creatorName?: string | null;
  creatorIconUrl?: string | null;
  /** Duration label such as `12:34`. */
  durationLabel?: string | null;
  /** Extra meta such as the publication time CURRENT shows on running events. */
  metaLabel?: string | null;
}

/** Mock `VideoCard` (`fn-vc`) inside a link, as on the event and creator pages. */
export function VideoCardLink({ video }: { video: ScreenVideoCard }): React.ReactElement {
  return (
    <Link href={video.href} className="scr-card">
      <div className="fn-vc">
        <div className="fn-vc__thumb">
          {video.thumbnailUrl ? <Image src={video.thumbnailUrl} alt="" /> : null}
        </div>
        <div>
          <div className="fn-vc__head">
            <p className="fn-vc__title">{video.title}</p>
            {video.durationLabel ? <span className="fn-vc__dur">{video.durationLabel}</span> : null}
          </div>
          {video.creatorName || video.metaLabel ? (
            <p className="fn-vc__meta">
              {video.creatorName ? (
                <span className="fn-vc__creator">
                  <span className="fn-vc__av">
                    {video.creatorIconUrl ? <Image src={video.creatorIconUrl} alt="" /> : <ScreenIcon name="user" />}
                  </span>
                  {video.creatorName}
                </span>
              ) : null}
              {video.metaLabel ? <span>{video.metaLabel}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/** External link attributes used by CURRENT for every off-site link. */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;
