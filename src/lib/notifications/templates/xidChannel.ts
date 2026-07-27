import {
  buildAllowedMentions,
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  formatJstDateTime,
  linkLine,
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

/** 運営チャンネル向け: X ID 申請受付通知。 */
export function buildChannelXIdRequestNotification(args: {
  requestId: string;
  requestType: XIdChannelRequestType;
  requestedXId?: string | null;
  sourceXUserId?: string | null;
  targetXUserId?: string | null;
  requesterUserId: string;
  requesterDiscordId?: string | null;
  requestedAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請を受け付けました",
      lines: [
        `申請種別: ${requestTypeLabel(args.requestType)}`,
        `申請 X ID: ${xIdLabel(args.requestedXId)}`,
        args.sourceXUserId
          ? `統合元 X ID: ${xIdLabel(args.sourceXUserId)}`
          : null,
        args.targetXUserId
          ? `統合先 X ID: ${xIdLabel(args.targetXUserId)}`
          : null,
        `申請者 user_id: ${escapeDiscordMention(args.requesterUserId)}`,
        args.requesterDiscordId
          ? `申請者 Discord ID: ${escapeDiscordMention(args.requesterDiscordId)}`
          : null,
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `申請時刻（日本時間）: ${formatJstDateTime(args.requestedAt)}`,
      ],
    },
    {
      heading: "■ 対応",
      lines: [linkLine("X ID 申請管理を開く", X_ID_REQUESTS_ADMIN_PATH)],
    },
  ]);
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
  requesterUserId: string;
  requesterDiscordId?: string | null;
  operatorUserId: string;
  reason?: string | null;
  rejectedAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請を却下しました",
      lines: [
        `申請種別: ${requestTypeLabel(args.requestType)}`,
        `申請 X ID: ${xIdLabel(args.requestedXId)}`,
        args.sourceXUserId
          ? `統合元 X ID: ${xIdLabel(args.sourceXUserId)}`
          : null,
        args.targetXUserId
          ? `統合先 X ID: ${xIdLabel(args.targetXUserId)}`
          : null,
        `申請者 user_id: ${escapeDiscordMention(args.requesterUserId)}`,
        args.requesterDiscordId
          ? `申請者 Discord ID: ${escapeDiscordMention(args.requesterDiscordId)}`
          : null,
        `処理者 user_id: ${escapeDiscordMention(args.operatorUserId)}`,
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `処理時刻（日本時間）: ${formatJstDateTime(args.rejectedAt)}`,
      ],
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
  requesterUserId: string;
  requesterDiscordId?: string | null;
  cancelledAt: number;
}): ReturnType<typeof buildDiscordPayload> {
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】X ID 申請が取り下げられました",
      lines: [
        `申請種別: ${requestTypeLabel(args.requestType)}`,
        `申請 X ID: ${xIdLabel(args.requestedXId)}`,
        args.sourceXUserId
          ? `統合元 X ID: ${xIdLabel(args.sourceXUserId)}`
          : null,
        args.targetXUserId
          ? `統合先 X ID: ${xIdLabel(args.targetXUserId)}`
          : null,
        `申請者 user_id: ${escapeDiscordMention(args.requesterUserId)}`,
        args.requesterDiscordId
          ? `申請者 Discord ID: ${escapeDiscordMention(args.requesterDiscordId)}`
          : null,
        `申請 ID: ${escapeDiscordMention(args.requestId)}`,
        `取消時刻（日本時間）: ${formatJstDateTime(args.cancelledAt)}`,
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
