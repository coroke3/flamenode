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

export type PublicEventCategory = "open" | "upcoming" | "ended";

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
}: PublicEventCardProps): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
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
    <Link
      href={`/event/${event.id}`}
      className="fn-evcard"
      data-kind={status}
      prefetch={false}
    >
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
        <h3 className="fn-evcard-title">{event.title}</h3>
      </div>
    </Link>
  );
}
