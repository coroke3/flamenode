import * as React from "react";
import Link from "next/link";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
  type EventStatusInput,
} from "@/lib/utils/eventStatus";
import { formatUnix } from "@/lib/utils/format";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";

export type PublicEventCardEvent = EventStatusInput & {
  id: string;
  title: string;
  explanation?: string | null;
  img_url?: string | null;
  icon_url?: string | null;
  accent_color?: string | null;
  entry_end_time?: number | null;
};

export type PublicEventCategory = "open" | "upcoming" | "ended" | "archive";

interface PublicEventCardProps {
  event: PublicEventCardEvent;
  category: PublicEventCategory;
  videoCount?: number | null;
  creatorCount?: number | null;
}

function formatRange(
  start: number | null | undefined,
  end: number | null | undefined,
): string {
  const startText = formatUnix(start, { dateOnly: true });
  const endText = formatUnix(end, { dateOnly: true });
  if (startText && endText) return `${startText} - ${endText}`;
  return startText || endText || "日程未定";
}

function daysUntilOpen(event: PublicEventCardEvent, now: number): number | null {
  const target =
    event.entry_end_time ??
    event.start_time ??
    event.end_time ??
    null;
  if (target == null || target <= now) return null;
  return Math.max(0, Math.ceil((target - now) / 86_400));
}

function pillTone(
  status: ReturnType<typeof computeEventStatus>,
  accepting: boolean,
): "accent" | "warn" | "muted" {
  if (accepting) return "accent";
  if (status === "scheduled") return "warn";
  return "muted";
}

export function PublicEventCard({
  event,
  category,
  videoCount,
  creatorCount,
}: PublicEventCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
  const days = category === "open" ? daysUntilOpen(event, now) : null;
  const accent = event.accent_color ?? undefined;
  const posterImage = cachedGoogleImageUrl(event.img_url);
  const posterStyle = {
    ...(accent ? { ["--ev-accent" as string]: accent } : {}),
    ...(posterImage
      ? {
          backgroundImage: `url(${posterImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {}),
  } as React.CSSProperties;

  return (
    <Link href={`/event/${event.id}`} className="fn-evcard" data-kind={status}>
      <div className="fn-evcard-poster" style={posterStyle}>
        <div className="fn-evcard-poster-grid" aria-hidden />
      </div>
      <div className="fn-evcard-body">
        <div className="fn-evcard-top">
          <span className="fn-pill" data-tone={pillTone(status, accepting)}>
            {eventStatusLabel(status)}
          </span>
          <span className="fn-mono fn-evcard-range">
            {formatRange(event.start_time, event.end_time)}
          </span>
        </div>
        <h3 className="fn-display fn-evcard-title">
          {event.icon_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={event.icon_url}
              alt=""
              className="fn-evcard-icon"
            />
          ) : null}
          {event.title}
        </h3>
        {event.explanation ? (
          <p className="fn-evcard-summary">{event.explanation}</p>
        ) : null}
        <div className="fn-evcard-foot fn-mono">
          {videoCount != null ? <span>{videoCount} 作品</span> : null}
          {videoCount != null && creatorCount != null ? (
            <span className="fn-evcard-sep" aria-hidden />
          ) : null}
          {creatorCount != null ? <span>{creatorCount} 名</span> : null}
          {days != null ? (
            <>
              <span className="fn-evcard-sep" aria-hidden />
              <span className="fn-evcard-days">{days} 日</span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
