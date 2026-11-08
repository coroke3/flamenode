/**
 * MIG-0659 U02: ops-channel text for X ID request / cancel notifications (SA-099 / SA-100).
 *
 * Text and payload shape are identical to CURRENT src/lib/notifications/templates/xidChannel.ts
 * (buildChannelXIdRequestNotification / buildChannelXIdCancelledNotification / thread names),
 * except that the public origin is injected (`siteUrl`) instead of read from process.env, which
 * server-core must not touch. The Next copy stays as the rollback path; the parity test compares the
 * persisted payload_json of both implementations field by field.
 */
import { escapeDiscordMention, type DiscordBlock } from "./discordText.ts";
import { formatOpsActorSection, type NotificationActor } from "./actor.ts";

export type XIdChannelRequestType = "new_link" | "existing_link" | "alias";

const X_ID_REQUESTS_ADMIN_PATH = "/admin/x-link-requests";
const DISCORD_THREAD_NAME_MAX = 100;
const MAX_PAYLOAD_BYTES = 8 * 1024;

const REQUEST_TYPE_LABELS: Record<XIdChannelRequestType, string> = {
  new_link: "新規 X ID 連携",
  existing_link: "既存 X ID 連携",
  alias: "X ID 別名追加",
};

const JST_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function formatJstDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("ja-JP", JST_FORMAT);
}

/** CURRENT notificationSiteOrigin with the env injected (the Worker origin is also verified by the write guard). */
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

function xIdLabel(xUserId: string | null | undefined): string {
  return xUserId ? escapeDiscordMention(`@${xUserId}`) : "（指定なし）";
}

function actorThreadLabel(actor: NotificationActor | null): string {
  if (!actor) return "不明";
  const xId = actor.activeXId?.trim();
  if (xId) return `@${xId}`;
  const xName = actor.activeXName?.trim();
  if (xName) return xName;
  const discordName = actor.discordName?.trim();
  if (discordName) return discordName;
  return actor.userId || "不明";
}

function requestContentLines(args: {
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requestedXName?: string | null;
}): Array<string | null> {
  return [
    `申請種別: ${REQUEST_TYPE_LABELS[args.requestType]}`,
    `申請 X ID: ${xIdLabel(args.requestedXId)}`,
    args.requestedXName?.trim()
      ? `X 表示名: ${escapeDiscordMention(args.requestedXName.trim())}`
      : null,
    args.sourceXUserId ? `統合元 X ID: ${xIdLabel(args.sourceXUserId)}` : null,
    args.targetXUserId ? `統合先 X ID: ${xIdLabel(args.targetXUserId)}` : null,
  ];
}

export function buildXIdRequestThreadName(xid: string, actor: NotificationActor | null): string {
  return `[X ID申請] @${xid} / ${actorThreadLabel(actor)}`;
}

export function buildXIdCancelThreadName(xid: string, actor: NotificationActor | null): string {
  return `[X ID取消] @${xid} / ${actorThreadLabel(actor)}`;
}

type ChannelPayload = {
  content: string;
  allowed_mentions: { parse: [] };
  url: string;
};

// CURRENT buildDiscordPayload key order: content, allowed_mentions, url.
function channelPayload(content: string): ChannelPayload {
  return { content, allowed_mentions: { parse: [] }, url: X_ID_REQUESTS_ADMIN_PATH };
}

function openAdminLine(siteUrl: string | null | undefined): string {
  return `X ID 申請管理を開く\n${appUrl(X_ID_REQUESTS_ADMIN_PATH, siteUrl)}`;
}

export function buildChannelXIdRequestNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requestedXName?: string | null;
  requester: NotificationActor | null;
  requestedAt: number;
  siteUrl: string | null | undefined;
}): ChannelPayload {
  return channelPayload(
    buildNotificationBlocks([
      { heading: "【運営通知】X ID 申請を受け付けました", lines: [] },
      { heading: "■ 申請内容", lines: requestContentLines(args) },
      formatOpsActorSection(args.requester, "■ 申請者"),
      {
        heading: "■ 申請情報",
        lines: [
          `申請 ID: ${escapeDiscordMention(args.requestId)}`,
          `申請時刻（日本時間）: ${formatJstDateTime(args.requestedAt)}`,
        ],
      },
      { heading: "■ 対応", lines: [openAdminLine(args.siteUrl)] },
    ]),
  );
}

export function buildChannelXIdCancelledNotification(args: {
  requestId: string;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requester: NotificationActor | null;
  cancelledAt: number;
  siteUrl: string | null | undefined;
}): ChannelPayload {
  const xid = args.requestedXId ?? args.sourceXUserId ?? args.targetXUserId ?? "不明";
  return channelPayload(
    buildNotificationBlocks([
      {
        heading: "【運営通知】X ID 申請が取り下げられました",
        lines: [
          `申請 X ID: ${xIdLabel(xid === "不明" ? null : xid)}`,
          `申請 ID: ${escapeDiscordMention(args.requestId)}`,
          `取消時刻（日本時間）: ${formatJstDateTime(args.cancelledAt)}`,
        ],
      },
      formatOpsActorSection(args.requester, "■ 取消者"),
      { heading: "■ 確認", lines: [openAdminLine(args.siteUrl)] },
    ]),
  );
}

function neutralizeDiscordMentionsInThreadName(input: string): string {
  return input
    .replace(/@everyone/gi, (match) => `@​${match.slice(1)}`)
    .replace(/@here/gi, (match) => `@​${match.slice(1)}`)
    .replace(/<@&[0-9]+>/g, "")
    .replace(/<@!?[0-9]+>/g, "");
}

/** CURRENT sanitizeDiscordThreadName. */
export function sanitizeDiscordThreadName(input: string, fallback: string): string {
  const cleaned = neutralizeDiscordMentionsInThreadName(input)
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned.length > 0 ? cleaned : fallback.trim();
  if (base.length <= DISCORD_THREAD_NAME_MAX) return base;
  return base.slice(0, DISCORD_THREAD_NAME_MAX).trimEnd();
}

/** CURRENT validateNotificationPayload for type "discord_webhook" (same checks that can fire for these payloads). */
export function assertValidWebhookPayload(type: string, payload: Record<string, unknown>): void {
  const fail = (reason: string): never => {
    throw new Error(`通知 payload が不正です: ${reason}`);
  };
  if (type.length === 0 || type.length > 64 || !/^[a-z0-9_]+$/i.test(type)) fail("type");
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_PAYLOAD_BYTES) {
    fail(`payload が ${MAX_PAYLOAD_BYTES} バイトを超えています`);
  }
  const content = payload.content;
  if (content !== undefined && typeof content !== "string") {
    fail("payload.content は文字列である必要があります");
  }
  if (typeof content === "string" && content.length > 2000) {
    fail("payload.content は 2000 文字以内にしてください");
  }
  const threadName = payload.thread_name;
  if (typeof threadName === "string" && threadName.length > 100) {
    fail("payload.thread_name は 100 文字以内にしてください");
  }
}
