import type { NotificationActor } from "../actor";
import { formatOpsActorSection } from "../actor";
import {
  buildAllowedMentions,
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  formatJstDateTime,
  linkLine,
  type DiscordBlock,
} from "./common";

const X_ID_REQUESTS_ADMIN_PATH = "/admin/x-link-requests";

type XIdChannelRequestType = "new_link" | "existing_link" | "alias";

const REQUEST_TYPE_LABELS: Record<XIdChannelRequestType, string> = {
  new_link: "新規 X ID 連携",
  existing_link: "既存 X ID 連携",
  alias: "X ID 別名追加",
};

function requestTypeLabel(requestType: XIdChannelRequestType): string {
  return REQUEST_TYPE_LABELS[requestType];
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

function primaryXId(
  requestedXId?: string | null,
  sourceXUserId?: string | null,
  targetXUserId?: string | null,
): string {
  return requestedXId ?? sourceXUserId ?? targetXUserId ?? "不明";
}

function requestContentLines(args: {
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requestedXName?: string | null;
}): Array<string | null> {
  return [
    `申請種別: ${requestTypeLabel(args.requestType)}`,
    `申請 X ID: ${xIdLabel(args.requestedXId)}`,
    args.requestedXName?.trim()
      ? `X 表示名: ${escapeDiscordMention(args.requestedXName.trim())}`
      : null,
    args.sourceXUserId ? `統合元 X ID: ${xIdLabel(args.sourceXUserId)}` : null,
    args.targetXUserId ? `統合先 X ID: ${xIdLabel(args.targetXUserId)}` : null,
  ];
}

/** X ID 申請 forum thread 名。 */
export function buildXIdRequestThreadName(
  xid: string,
  actor: NotificationActor | null,
): string {
  return `[X ID申請] @${xid} / ${actorThreadLabel(actor)}`;
}

/** X ID 取消 forum thread 名。 */
export function buildXIdCancelThreadName(
  xid: string,
  actor: NotificationActor | null,
): string {
  return `[X ID取消] @${xid} / ${actorThreadLabel(actor)}`;
}

/** X ID 却下 forum thread 名。 */
export function buildXIdRejectThreadName(
  xid: string,
  requester: NotificationActor | null,
): string {
  return `[X ID却下] @${xid} / ${actorThreadLabel(requester)}`;
}

/** X ID 承認 forum thread 名。 */
export function buildXIdApproveThreadName(
  xid: string,
  requester: NotificationActor | null,
): string {
  return `[X ID承認] @${xid} / ${actorThreadLabel(requester)}`;
}

/** 運営チャンネル向け: X ID 申請受付通知。 */
export function buildChannelXIdRequestNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requestedXName?: string | null;
  requester: NotificationActor | null;
  requestedAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const blocks: DiscordBlock[] = [
    {
      heading: "【運営通知】X ID 申請を受け付けました",
      lines: [],
    },
    {
      heading: "■ 申請内容",
      lines: requestContentLines(args),
    },
    formatOpsActorSection(args.requester, "■ 申請者"),
    {
      heading: "■ 申請情報",
      lines: [
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `申請時刻（日本時間）: ${formatJstDateTime(args.requestedAt)}`,
      ],
    },
    {
      heading: "■ 対応",
      lines: [linkLine("X ID 申請管理を開く", X_ID_REQUESTS_ADMIN_PATH)],
    },
  ];
  const content = buildNotificationBlocks(blocks);
  return buildDiscordPayload({
    content,
    allowedMentions: buildAllowedMentions(),
    url: X_ID_REQUESTS_ADMIN_PATH,
  });
}

/** 運営チャンネル向け: X ID 申請却下通知。 */
export function buildChannelXIdRejectedNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requester: NotificationActor | null;
  operator: NotificationActor | null;
  reason?: string | null;
  rejectedAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請を却下しました",
      lines: [],
    },
    formatOpsActorSection(args.requester, "■ 申請者"),
    formatOpsActorSection(args.operator, "■ 処理者"),
    {
      heading: "■ 申請",
      lines: [
        ...requestContentLines(args),
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `処理時刻（日本時間）: ${formatJstDateTime(args.rejectedAt)}`,
      ],
    },
    {
      heading: "■ 結果",
      lines: ["却下"],
    },
    {
      heading: "■ 却下理由",
      lines: [
        args.reason?.trim()
          ? escapeDiscordMention(args.reason.trim())
          : "理由の入力なし",
      ],
    },
    {
      heading: "■ 確認",
      lines: [linkLine("X ID 申請管理を開く", X_ID_REQUESTS_ADMIN_PATH)],
    },
  ]);
  return buildDiscordPayload({
    content,
    allowedMentions: buildAllowedMentions(),
    url: X_ID_REQUESTS_ADMIN_PATH,
  });
}

/** 運営チャンネル向け: 申請者本人によるX ID申請取消通知。 */
export function buildChannelXIdCancelledNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requester: NotificationActor | null;
  cancelledAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const xid = primaryXId(
    args.requestedXId,
    args.sourceXUserId,
    args.targetXUserId,
  );
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請が取り下げられました",
      lines: [
        `申請 X ID: ${xIdLabel(xid === "不明" ? null : xid)}`,
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `取消時刻（日本時間）: ${formatJstDateTime(args.cancelledAt)}`,
      ],
    },
    formatOpsActorSection(args.requester, "■ 取消者"),
    {
      heading: "■ 確認",
      lines: [linkLine("X ID 申請管理を開く", X_ID_REQUESTS_ADMIN_PATH)],
    },
  ]);
  return buildDiscordPayload({
    content,
    allowedMentions: buildAllowedMentions(),
    url: X_ID_REQUESTS_ADMIN_PATH,
  });
}

/** 運営チャンネル向け: X ID 申請承認通知。 */
export function buildChannelXIdApprovedNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requester: NotificationActor | null;
  operator: NotificationActor | null;
  approvedAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請を承認しました",
      lines: [],
    },
    formatOpsActorSection(args.requester, "■ 申請者"),
    formatOpsActorSection(args.operator, "■ 処理者"),
    {
      heading: "■ 処理内容",
      lines: [
        ...requestContentLines(args),
        `結果: 承認`,
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `処理時刻（日本時間）: ${formatJstDateTime(args.approvedAt)}`,
      ],
    },
    {
      heading: "■ 確認",
      lines: [linkLine("X ID 申請管理を開く", X_ID_REQUESTS_ADMIN_PATH)],
    },
  ]);
  return buildDiscordPayload({
    content,
    allowedMentions: buildAllowedMentions(),
    url: X_ID_REQUESTS_ADMIN_PATH,
  });
}
