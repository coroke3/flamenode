"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { createEvent, updateEvent } from "@/lib/actions/event-admin";
import { PermissionKeysField } from "@/components/admin/PermissionKeysField";

export interface EventFormInitial {
  id?: string;
  title?: string;
  event_type?: "event" | "collabo" | "type" | "other";
  explanation?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
  accent_color?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
  is_active?: number;
  is_entry_open?: number;
  is_archived?: number;
  allow_user_video_event_links?: number;
  allow_user_video_edits?: number;
  user_video_edit_permission_keys_json?: string | null;
  max_slots_per_video?: number;
  max_consecutive_slots_per_entry?: number;
  slot_type?: "time" | "count";
  slot_visibility_mode?: "public_name" | "anonymous" | "hidden";
  slot_part_gap_minutes?: number | null;
}

interface EventFormProps {
  mode: "create" | "edit";
  initial?: EventFormInitial;
}

function unixToInputDateTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({
  mode,
  initial = {},
}: EventFormProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = mode === "create" ? await createEvent(fd) : await updateEvent(fd);
      if (!r.ok) {
        setError(r.message ?? "失敗しました。");
        return;
      }
      setSuccess("保存しました。");
      if (mode === "create" && r.eventId) {
        router.push(`/admin/events/${r.eventId}/edit`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {mode === "edit" && initial.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}

      <div>
        <label className="fn-label">
          ID {mode === "create" ? "(空欄で自動生成)" : "(変更不可)"}
        </label>
        <input
          name="id"
          type="text"
          defaultValue={initial.id ?? ""}
          className="fn-input"
          readOnly={mode === "edit"}
          placeholder="例: spring_2026"
          pattern="[A-Za-z0-9_-]*"
          maxLength={64}
        />
      </div>

      <div>
        <label className="fn-label">タイトル *</label>
        <input
          name="title"
          type="text"
          defaultValue={initial.title ?? ""}
          className="fn-input"
          maxLength={200}
          required
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">種別</label>
          <select
            name="event_type"
            defaultValue={initial.event_type ?? "event"}
            className="fn-select"
          >
            <option value="event">event (通常)</option>
            <option value="collabo">collabo (コラボ)</option>
            <option value="type">type (タイプ別)</option>
            <option value="other">other</option>
          </select>
        </div>
        <div>
          <label className="fn-label">枠タイプ</label>
          <select
            name="slot_type"
            defaultValue={initial.slot_type ?? "time"}
            className="fn-select"
          >
            <option value="time">時間付き</option>
            <option value="count">時間なし (番号のみ)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="fn-label">説明</label>
        <textarea
          name="explanation"
          defaultValue={initial.explanation ?? ""}
          className="fn-input"
          rows={4}
          maxLength={4000}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">アイコン URL</label>
          <input
            name="icon_url"
            type="url"
            defaultValue={initial.icon_url ?? ""}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">バナー画像 URL</label>
          <input
            name="img_url"
            type="url"
            defaultValue={initial.img_url ?? ""}
            className="fn-input"
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">開始日時</label>
          <input
            name="start_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.start_time)}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">終了日時</label>
          <input
            name="end_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.end_time)}
            className="fn-input"
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">募集開始日時</label>
          <input
            name="entry_start_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.entry_start_time)}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">募集終了日時</label>
          <input
            name="entry_end_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.entry_end_time)}
            className="fn-input"
          />
        </div>
      </div>

      <div>
        <label className="fn-label">アクセントカラー (HEX)</label>
        <input
          name="accent_color"
          type="text"
          defaultValue={initial.accent_color ?? ""}
          className="fn-input"
          maxLength={20}
          placeholder="#ffd400"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div>
          <label className="fn-label">公開</label>
          <select
            name="is_active"
            defaultValue={String(initial.is_active ?? 0)}
            className="fn-select"
          >
            <option value="0">下書き</option>
            <option value="1">公開</option>
          </select>
        </div>
        <div>
          <label className="fn-label">受付</label>
          <select
            name="is_entry_open"
            defaultValue={String(initial.is_entry_open ?? 0)}
            className="fn-select"
          >
            <option value="0">閉</option>
            <option value="1">開</option>
          </select>
        </div>
        <div>
          <label className="fn-label">アーカイブ</label>
          <select
            name="is_archived"
            defaultValue={String(initial.is_archived ?? 0)}
            className="fn-select"
          >
            <option value="0">通常</option>
            <option value="1">アーカイブ</option>
          </select>
        </div>
        <div>
          <label
            className="fn-label"
            title="作品投稿者が VideoForm の所属イベント選択でこのイベントを追加できるかどうか"
          >
            一般ユーザーの追加紐付け
          </label>
          <select
            name="allow_user_video_event_links"
            defaultValue={String(initial.allow_user_video_event_links ?? 0)}
            className="fn-select"
          >
            <option value="0">運営承認制 (既定)</option>
            <option value="1">許可</option>
          </select>
        </div>
      </div>

      {/*
        作品編集の「ユーザー権限上書き」: イベント単位で section_key を委譲する。
        - 既定は無効。有効にしたイベントだけ permission_keys_json で section を絞る。
        - 危険キー (videos.youtube_id / videos.primary_event / video.identity) は
          サーバー側 ownership.ts で除外する (許可リスト方式)。
      */}
      <fieldset
        style={{
          marginTop: 16,
          padding: "12px 14px",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          display: "grid",
          gap: 10,
        }}
      >
        <legend
          style={{
            padding: "0 6px",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-muted)",
          }}
        >
          一般ユーザー向け作品編集の許可 (イベント単位)
        </legend>
        <div>
          <label
            className="fn-label"
            title="このイベントに紐づく作品について、作品オーナー以外にも一部編集権限を与えるか"
          >
            一般ユーザーの作品編集を許可
          </label>
          <select
            name="allow_user_video_edits"
            defaultValue={String(initial.allow_user_video_edits ?? 0)}
            className="fn-select"
          >
            <option value="0">無効 (既定。動画オーナー / 合作 / 運営のみ)</option>
            <option value="1">有効 (下記 JSON の section_key を委譲)</option>
          </select>
        </div>
        <div>
          <label className="fn-label">
            委譲する section_key (JSON 配列)
          </label>
          <PermissionKeysField
            name="user_video_edit_permission_keys_json"
            defaultValue={initial.user_video_edit_permission_keys_json}
          />
        </div>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">1作品あたり最大枠数</label>
          <input
            name="max_slots_per_video"
            type="number"
            min={1}
            max={20}
            defaultValue={initial.max_slots_per_video ?? 1}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">連続取得上限</label>
          <input
            name="max_consecutive_slots_per_entry"
            type="number"
            min={1}
            max={20}
            defaultValue={initial.max_consecutive_slots_per_entry ?? 3}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">
            部の分割閾値 (分) <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>デフォルト 30</span>
          </label>
          <input
            name="slot_part_gap_minutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={initial.slot_part_gap_minutes ?? 30}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">確保者表示</label>
          <select
            name="slot_visibility_mode"
            defaultValue={initial.slot_visibility_mode ?? "public_name"}
            className="fn-select"
          >
            <option value="public_name">名前公開</option>
            <option value="anonymous">匿名</option>
            <option value="hidden">非表示</option>
          </select>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          <Icon name="warning" size={13} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 13 }}>
          <Icon name="check" size={13} aria-hidden /> {success}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={busy}
          aria-busy={busy}
        >
          <Icon name="check" size={13} aria-hidden />
          {busy ? "保存中…" : mode === "create" ? "作成" : "保存"}
        </button>
      </div>
    </form>
  );
}
