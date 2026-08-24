"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setDisabledFeatures } from "@/lib/actions/cost-guard";
import {
  isWriteFeatureKey,
  WRITE_FEATURE_KEYS,
  type WriteFeatureKey,
} from "@/lib/auth/writeGuardCore";

const FEATURE_LABELS: Partial<Record<WriteFeatureKey, string>> = {
  post_video_unslotted: "枠なし作品の投稿",
  post_video_slotted: "枠付き作品の投稿",
  edit_video: "作品の編集",
  like_or_bookmark: "いいね・ブックマーク",
  chapter_comment: "チャプターコメント",
  reserve_slot: "枠の確保",
  release_slot: "枠の解放",
  xid_links: "X ID連携",
  split_slot_group: "連続枠の分割",
  extend_slot_group: "連続枠の拡張",
  merge_slot_groups: "連続枠の結合",
  admin_user_role: "ユーザー権限管理",
  admin_user_ban: "ユーザー停止",
  admin_user_notifications: "通知管理",
  admin_user_event_create: "ユーザーのイベント作成",
  admin_event_create: "イベント作成",
  admin_x_icon_refresh: "Xアイコン再計算",
  admin_terms_create: "規約作成",
  admin_terms_update: "規約更新",
  admin_terms_publish: "規約公開",
  admin_terms_archive: "規約アーカイブ",
  admin_terms_broadcast: "規約通知",
  admin_moderation_create: "モデレーション作成",
  admin_moderation_update: "モデレーション更新",
  admin_announcement_broadcast: "お知らせ配信",
  admin_video_status: "作品ステータス管理",
  admin_api_endpoints: "APIエンドポイント管理",
  admin_event_templates: "イベントテンプレート管理",
  admin_permissions: "権限管理",
  admin_youtube_sync: "YouTube同期",
  admin_notifications: "通知管理（管理者）",
  admin_static_rebuild: "静的データ再生成",
  admin_video_collab_permissions: "合作編集権限",
  admin_legacy_import: "legacy import",
  admin_spreadsheet: "管理スプレッドシート",
  manage_event_update: "イベント更新",
  manage_event_archive: "イベントアーカイブ",
  manage_slot_create: "枠作成",
  manage_slot_update: "枠更新",
  manage_slot_delete: "枠削除",
  manage_event_staff: "イベントスタッフ管理",
  manage_video_status: "作品ステータス（運営）",
};

function parseInitialFeatures(raw: string | null): { features: string[]; malformed: boolean } {
  if (!raw) return { features: [], malformed: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length <= 100 &&
      parsed.every((value) => isWriteFeatureKey(value))
    ) {
      return { features: [...new Set(parsed as string[])], malformed: false };
    }
    return { features: [], malformed: true };
  } catch {
    return { features: [], malformed: true };
  }
}

export function CostGuardDisabledFeaturesForm({
  disabledFeaturesJson,
}: {
  disabledFeaturesJson: string | null;
}): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const initial = React.useMemo(
    () => parseInitialFeatures(disabledFeaturesJson),
    [disabledFeaturesJson],
  );
  const [features, setFeatures] = React.useState(initial.features);
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFeatures(initial.features);
  }, [initial.features]);

  const submit = () => {
    const formData = new FormData();
    features.forEach((feature) => formData.append("features", feature));
    formData.set("expected_disabled_features_json", JSON.stringify(disabledFeaturesJson));
    formData.set("reason", reason);
    formData.set("confirm", confirm);
    setMessage(null);
    startTransition(async () => {
      const result = await setDisabledFeatures(formData);
      setMessage(result.message ?? (result.ok ? "更新しました。" : "更新に失敗しました。"));
      if (result.ok) {
        setReason("");
        setConfirm("");
        router.refresh();
      }
    });
  };

  return (
    <section style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>恒久的な無効化機能</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        一時的なoverrideではなく、Cost Guardが通常時にも停止する書込み機能を指定します。Spreadsheetからは変更できません。
      </p>
      {initial.malformed ? (
        <p role="alert" style={{ fontSize: 12, color: "var(--status-danger, #c33)" }}>
          現在の無効化機能設定が不正なため、安全のため書込み機能は停止中です。内容を確認して明示的に保存してください。
        </p>
      ) : null}
      <fieldset disabled={busy} style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto", padding: 10 }}>
        <legend style={{ fontSize: 12 }}>無効化する機能（空欄で全て有効）</legend>
        {WRITE_FEATURE_KEYS.map((feature) => (
          <label key={feature} style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={features.includes(feature)}
              onChange={(event) => {
                setFeatures((current) => event.currentTarget.checked
                  ? [...current, feature]
                  : current.filter((item) => item !== feature));
              }}
            />{" "}{FEATURE_LABELS[feature] ?? feature}{" "}
            <code style={{ color: "var(--text-muted)", fontSize: 11 }}>({feature})</code>
          </label>
        ))}
      </fieldset>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <input className="fn-input" value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={500} placeholder="変更理由（必須）" disabled={busy} />
        <input className="fn-input" value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} placeholder="APPLY" disabled={busy} />
      </div>
      <button type="button" className="fn-btn fn-btn-warning fn-btn-sm" disabled={busy || confirm !== "APPLY" || !reason.trim()} onClick={submit} style={{ marginTop: 8 }}>
        無効化設定を保存
      </button>
      {message ? <p role="status" style={{ fontSize: 12 }}>{message}</p> : null}
    </section>
  );
}
