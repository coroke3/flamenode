import {
  appUrl,
  type DiscordNotificationPayload,
  type NotificationUrlEnv,
} from "../format";
import type { OpsWebhookTarget } from "../forum";

export type DiscordAllowedMentions = {
  parse?: Array<"roles" | "users" | "everyone">;
  users?: string[];
  roles?: string[];
};

export type DiscordBlock = {
  heading?: string;
  lines: Array<string | null | undefined | false>;
};

export type DiscordNotificationBody = DiscordNotificationPayload & {
  allowed_mentions?: DiscordAllowedMentions;
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

/** Unix秒を日本時間の表示用文字列へ変換する。 */
export function formatJstDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("ja-JP", JST_FORMAT);
}

/** 現在時刻を日本時間で返す（通知文面の「送信時刻」用）。 */
export function formatJstNow(unixSec = Math.floor(Date.now() / 1000)): string {
  return formatJstDateTime(unixSec);
}

const VIDEO_STATUS_LABELS: Record<string, string> = {
  public: "公開中",
  pending: "運営確認待ち",
  voided: "無効",
  private: "非公開",
  limited: "限定公開",
  archived: "アーカイブ",
  draft: "下書き",
};

const SLOT_STATUS_LABELS: Record<string, string> = {
  available: "空き",
  reserved: "予約済み",
  submitted: "投稿済み",
};

/** 作品の公開状態を日本語ラベルへ変換する。 */
export function localizeVideoStatus(status: string): string {
  return VIDEO_STATUS_LABELS[status] ?? status;
}

/** 枠の状態を日本語ラベルへ変換する。 */
export function localizeSlotStatus(status: string): string {
  return SLOT_STATUS_LABELS[status] ?? status;
}

/** Discordメンション誤爆を防ぐためのエスケープ。 */
export function escapeDiscordMention(text: string): string {
  return text
    .replace(/@/g, "@\u200b")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>");
}

/** 空行・空文字を除去する。 */
export function omitEmptyLines(
  lines: Array<string | null | undefined | false>,
): string[] {
  return lines.filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

/** Discord API の allowed_mentions を組み立てる。デフォルトはメンション無効。 */
export function buildAllowedMentions(opts?: {
  everyone?: boolean;
  users?: string[];
  roles?: string[];
}): DiscordAllowedMentions {
  if (!opts?.everyone && !opts?.users?.length && !opts?.roles?.length) {
    return { parse: [] };
  }
  const allowed: DiscordAllowedMentions = { parse: [] };
  if (opts.everyone) allowed.parse!.push("everyone");
  if (opts.users?.length) allowed.users = opts.users;
  if (opts.roles?.length) allowed.roles = opts.roles;
  return allowed;
}

/** 見出し付きブロックを結合して通知本文を組み立てる。 */
export function buildNotificationBlocks(blocks: DiscordBlock[]): string {
  const sections: string[] = [];
  for (const block of blocks) {
    const lines = omitEmptyLines(block.lines);
    if (block.heading) {
      sections.push(block.heading);
    }
    if (lines.length > 0) {
      sections.push(lines.join("\n"));
    }
  }
  return sections.join("\n\n");
}

/** ラベル付きの完全URL行を返す。 */
export function linkLine(
  label: string,
  path: string,
  env?: NotificationUrlEnv,
): string {
  return `${label}\n${appUrl(path, env)}`;
}

/** テンプレート共通の payload 組み立て。 */
export function buildDiscordPayload(args: {
  content: string;
  allowedMentions?: DiscordAllowedMentions;
  /** Discord API へは送らない内部メタ。呼び出し側の snake_case も受け付ける。 */
  videoId?: string;
  eventId?: string;
  url?: string;
  video_id?: string;
  event_id?: string;
  webhookTarget?: OpsWebhookTarget;
  threadName?: string;
  webhook_target?: OpsWebhookTarget;
  thread_name?: string;
}): DiscordNotificationBody {
  const videoId = args.videoId ?? args.video_id;
  const eventId = args.eventId ?? args.event_id;
  const webhookTarget = args.webhookTarget ?? args.webhook_target;
  const threadName = args.threadName ?? args.thread_name;
  return {
    content: args.content,
    ...(args.allowedMentions ? { allowed_mentions: args.allowedMentions } : {}),
    ...(videoId ? { video_id: videoId } : {}),
    ...(eventId ? { event_id: eventId } : {}),
    ...(args.url ? { url: args.url } : {}),
    ...(webhookTarget ? { webhook_target: webhookTarget } : {}),
    ...(threadName ? { thread_name: threadName } : {}),
  };
}
