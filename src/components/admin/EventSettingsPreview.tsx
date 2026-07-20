import * as React from "react";
import type { EditableCustomQuestion } from "@/lib/video/customQuestions";

export interface EventSettingsPreviewValue {
  title?: string | null;
  event_type?: string | null;
  explanation?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
  accent_color?: string | null;
  start_time?: number | string | null;
  end_time?: number | string | null;
  entry_start_time?: number | string | null;
  entry_end_time?: number | string | null;
  visibility_status?: string | null;
  allow_user_video_event_links?: number | string | null;
  allow_unslotted_posts?: number | string | null;
  allow_user_video_edits?: number | string | null;
  user_video_edit_permission_keys_json?: string | null;
  custom_questions?: EditableCustomQuestion[];
  max_slots_per_video?: number | string | null;
  slot_type?: string | null;
  slot_visibility_mode?: string | null;
  slot_part_gap_minutes?: number | string | null;
  parts_json?: string | null;
  parts_text?: string | null;
  editable_fields?: string | null;
  review_settings?: string | null;
}

function toBool(value: number | string | boolean | null | undefined): boolean {
  return value === 1 || value === "1" || value === true;
}

function visibilityLabel(event: EventSettingsPreviewValue): {
  label: string;
  className: string;
} {
  switch (event.visibility_status) {
    case "public": return { label: "公開", className: "fn-badge-accent" };
    case "private": return { label: "非公開", className: "fn-badge-soft" };
    case "archived": return { label: "アーカイブ", className: "fn-badge-warning" };
    default: return { label: "下書き", className: "fn-badge-soft" };
  }
}

function displayDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "未設定";
  if (typeof value === "number") {
    return new Date(value * 1000).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
  }
  return value.includes("T") ? value.replace("T", " ") : value;
}

function parseParts(value: EventSettingsPreviewValue): {
  parts: string[];
  error: string | null;
} {
  if (value.parts_text != null) {
    return {
      parts: value.parts_text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      error: null,
    };
  }
  if (!value.parts_json) return { parts: [], error: null };
  try {
    const parsed = JSON.parse(value.parts_json) as unknown;
    if (!Array.isArray(parsed)) {
      return { parts: [], error: "parts_json は配列ではありません。" };
    }
    return {
      parts: parsed.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      ),
      error: null,
    };
  } catch {
    return { parts: [], error: "parts_json を解析できません。" };
  }
}

function tryJsonSummary(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "未設定";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return `${parsed.length} 件`;
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>).join(", ") || "空オブジェクト";
    }
    return String(parsed);
  } catch {
    return "JSONを解析できません";
  }
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function questionTypeLabel(type: EditableCustomQuestion["type"]): string {
  switch (type) {
    case "text": return "1行テキスト";
    case "textarea": return "長文テキスト";
    case "select": return "プルダウン";
    case "radio": return "ラジオ";
    case "checkbox": return "複数チェック";
  }
}

export function EventSettingsPreview({
  event,
}: {
  event: EventSettingsPreviewValue;
}): React.ReactElement {
  const accent = event.accent_color?.trim() || "var(--accent-primary)";
  const questions = (event.custom_questions ?? [])
    .filter((question) => question.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const parts = parseParts(event);
  const slotType = event.slot_type ?? "time";
  const visibility = visibilityLabel(event);

  return (
    <section
      aria-label="イベント設定プレビュー"
      style={{
        marginTop: 18,
        padding: 16,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-elevated)",
        display: "grid",
        gap: 16,
      }}
    >
      <header style={{ display: "grid", gap: 4 }}>
        <span className="fn-badge fn-badge-soft" style={{ justifySelf: "start" }}>
          プレビュー
        </span>
        <h2 style={{ margin: 0, fontSize: 16 }}>イベント設定プレビュー</h2>
      </header>

      <article style={{
        border: "1px solid var(--border-subtle)",
        borderTop: `4px solid ${accent}`,
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        background: "var(--bg-surface)",
      }}>
        {event.img_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.img_url}
            alt=""
            style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
          />
        ) : null}
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {event.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.icon_url}
                alt=""
                width={24}
                height={24}
                style={{ borderRadius: "50%", objectFit: "cover" }}
              />
            ) : null}
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                {event.title || "イベント名未入力"}
              </h3>
              <p className="fn-muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                {event.event_type ?? "event"}
              </p>
            </div>
          </div>
          <span className={`fn-badge ${visibility.className}`} style={{ justifySelf: "start" }}>
            {visibility.label}
          </span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {(event.explanation || "イベント説明は未入力です。").slice(0, 180)}
            {(event.explanation?.length ?? 0) > 180 ? "…" : ""}
          </p>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}>
            <Field label="開催期間" value={`${displayDate(event.start_time)} - ${displayDate(event.end_time)}`} />
            <Field label="受付期間" value={`${displayDate(event.entry_start_time)} - ${displayDate(event.entry_end_time)}`} />
          </div>
        </div>
      </article>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}>
        <article className="fn-card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>投稿フォーム項目</h3>
          {questions.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {questions.map((question, index) => (
                <div key={question.id} style={{ display: "grid", gap: 5 }}>
                  <span
                    className={`fn-badge ${
                      question.required ? "fn-badge-warning" : "fn-badge-soft"
                    }`}
                    style={{ justifySelf: "start" }}
                  >
                    質問 {index + 1} / {question.required ? "必須" : "任意"}
                  </span>
                  <Field label="ラベル" value={question.label} />
                  <Field label="形式" value={questionTypeLabel(question.type)} />
                  <Field label="説明" value={question.description || "なし"} />
                  {question.options.length > 0 ? (
                    <Field label="選択肢" value={question.options.join(" / ")} />
                  ) : null}
                  <Field label="公開範囲" value={question.visibility} />
                </div>
              ))}
            </div>
          ) : (
            <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
              追加質問は表示されません。
            </p>
          )}
        </article>

        <article className="fn-card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>部 / セクション</h3>
          {parts.error ? (
            <p style={{ color: "var(--accent-danger)", fontSize: 12 }}>{parts.error}</p>
          ) : parts.parts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {parts.parts.map((part) => (
                <span key={part} className="fn-badge fn-badge-soft">{part}</span>
              ))}
            </div>
          ) : (
            <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
              部の選択は表示されません。
            </p>
          )}
        </article>

        <article className="fn-card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>枠設定</h3>
          <div style={{ display: "grid", gap: 6 }}>
            <Field label="枠タイプ" value={slotType === "count" ? "件数枠" : "時間枠"} />
            <Field label="確保者表示" value={event.slot_visibility_mode ?? "public_name"} />
            <Field label="1作品あたり最大枠数" value={event.max_slots_per_video ?? 1} />
            <Field label="連続取得上限" value={event.max_consecutive_slots_per_entry ?? 3} />
            <Field label="部の分割閾値" value={`${event.slot_part_gap_minutes ?? 15} 分`} />
          </div>
        </article>

        <article className="fn-card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>権限・運用設定</h3>
          <div style={{ display: "grid", gap: 6 }}>
            <Field
              label="ユーザーの追加紐付け"
              value={toBool(event.allow_user_video_event_links) ? "許可" : "不許可"}
            />
            <Field
              label="枠なし投稿の紐づけ"
              value={toBool(event.allow_unslotted_posts) ? "許可" : "不許可"}
            />
            <Field
              label="一般ユーザー編集"
              value={toBool(event.allow_user_video_edits) ? "一部許可" : "通常権限"}
            />
            <Field
              label="許可キー"
              value={tryJsonSummary(event.user_video_edit_permission_keys_json)}
            />
            <Field label="editable_fields" value={tryJsonSummary(event.editable_fields)} />
            <Field label="review_settings" value={tryJsonSummary(event.review_settings)} />
          </div>
        </article>
      </div>
    </section>
  );
}
