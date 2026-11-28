/**
 * MIG-0657 U02: ops-channel text for slot reservation notifications (SA-065).
 *
 * Text and payload shape match CURRENT src/lib/notifications/templates/slot.ts
 * (buildSlotReservedOpsThreadName / buildChannelSlotReservedNotification), with
 * `siteUrl` injected instead of reading process.env (D-10).
 */
import { escapeDiscordMention, type DiscordBlock } from "./discordText.ts";
import { formatOpsActorSection, type NotificationActor } from "./actor.ts";

function siteOrigin(siteUrl: string | null | undefined): string {
  const raw = siteUrl?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL_MISSING");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  return url.origin;
}

function appUrl(path: string, siteUrl: string | null | undefined): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[/\\]{2}/.test(path)) {
    throw new Error("NOTIFICATION_PATH_MUST_BE_RELATIVE");
  }
  const origin = siteOrigin(siteUrl);
  const target = new URL(path.startsWith("/") ? path : `/${path}`, `${origin}/`);
  if (target.origin !== origin) throw new Error("NOTIFICATION_PATH_INVALID");
  return target.href;
}

function omitEmptyLines(lines: Array<string | null | undefined | false>): string[] {
  return lines.filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

function buildNotificationBlocks(blocks: DiscordBlock[]): string {
  const sections: string[] = [];
  for (const block of blocks) {
    const lines = omitEmptyLines(block.lines);
    if (block.heading) sections.push(block.heading);
    if (lines.length > 0) sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function linkLine(label: string, path: string, siteUrl: string | null | undefined): string {
  return `${label}\n${appUrl(path, siteUrl)}`;
}

function opsThreadActorLabel(actor: NotificationActor | null): string {
  if (!actor) return "unknown";
  const xId = actor.activeXId?.trim();
  if (xId) return `@${xId}`;
  const discordName = actor.discordName?.trim();
  if (discordName) return discordName;
  return actor.userId;
}

/** EVENT forum 向け thread_name（枠確保）。 */
export function buildSlotReservedOpsThreadName(
  eventTitle: string,
  actor: NotificationActor | null,
): string {
  const eventName = eventTitle.trim() || "イベント";
  return `[枠確保] ${eventName} / ${opsThreadActorLabel(actor)}`;
}

/** 運営チャンネル向け: 利用者による枠新規確保通知。 */
export function buildChannelSlotReservedNotification(args: {
  eventId: string;
  eventTitle: string;
  slotCount: number;
  slotDisplayName: string;
  actor: NotificationActor | null;
  siteUrl: string | null | undefined;
}): { content: string; event_id: string; url: string } {
  const eventName = escapeDiscordMention(args.eventTitle.trim() || "イベント");
  const slotsLabel = args.slotCount > 1 ? `${args.slotCount} 枠` : "1 枠";
  const reservationDisplayName = escapeDiscordMention(
    args.slotDisplayName.trim() || "（未設定）",
  );
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】枠が新規確保されました",
      lines: [`イベント: ${eventName}`, `確保枠: ${slotsLabel}`],
    },
    formatOpsActorSection(args.actor),
    {
      heading: "■ 予約上の表示名",
      lines: [reservationDisplayName],
    },
    {
      heading: "■ 確認",
      lines: [
        linkLine("イベント管理を開く", `/manage/events/${args.eventId}`, args.siteUrl),
        linkLine("イベントページを見る", `/event/${args.eventId}`, args.siteUrl),
      ],
    },
  ]);
  return {
    content,
    event_id: args.eventId,
    url: appUrl(`/manage/events/${args.eventId}`, args.siteUrl),
  };
}
