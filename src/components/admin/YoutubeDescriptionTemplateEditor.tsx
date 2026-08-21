"use client";

import * as React from "react";
import {
  MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  YOUTUBE_DESCRIPTION_VARIABLES,
  renderYoutubeDescriptionTemplate,
  type YoutubeDescriptionContext,
  type YoutubeDescriptionLoopMember,
  type YoutubeDescriptionVariableKey,
} from "@/lib/event/youtubeDescriptionTemplate";
import { writeTextToClipboard } from "@/lib/utils/clipboard";

const VARIABLE_GROUPS: ReadonlyArray<{
  label: string;
  keys: readonly YoutubeDescriptionVariableKey[];
}> = [
  {
    label: "イベント",
    keys: ["event_title", "event_id", "event_url", "part"],
  },
  {
    label: "作品",
    keys: [
      "video_id",
      "title",
      "youtube_video_id",
      "youtube_url",
      "music",
      "credit",
      "used_software",
    ],
  },
  {
    label: "投稿者",
    keys: [
      "creator_name",
      "creator_x_id",
      "creator_channel_url",
      "creator_profile",
      "creator_social_links",
    ],
  },
  {
    label: "共同制作者",
    keys: [
      "members",
      "member_names",
      "member_x_ids",
      "member_roles",
      "member_comments",
    ],
  },
  {
    label: "コメント・作品情報",
    keys: [
      "intro_comment",
      "highlights",
      "production_story",
      "closing_comment",
    ],
  },
];

const VARIABLE_LABELS = new Map(
  YOUTUBE_DESCRIPTION_VARIABLES.map((variable) => [variable.key, variable.label]),
);

const SAMPLE_CONTEXT: YoutubeDescriptionContext = {
  event_title: "サンプル映像祭2026",
  event_id: "sample-event",
  event_url: "https://flamenode.net/event/sample-event",
  video_id: "sample-video",
  title: "Sample Movie",
  youtube_video_id: "dQw4w9WgXcQ",
  youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  creator_name: "Flame Creator",
  creator_x_id: "@sample_creator",
  creator_channel_url: "https://www.youtube.com/@sample_creator",
  creator_profile: "映像制作をしています。",
  creator_social_links: "X: @sample_creator",
  members: "Flame Creator / Sample Member",
  member_names: "Flame Creator / Sample Member",
  member_x_ids: "@sample_creator / @sample_member",
  member_roles: "映像 / デザイン",
  member_comments: "共同制作コメント",
  part: "第1部",
  music: "Sample Music",
  credit: "Music: Sample Artist",
  intro_comment: "作品紹介のサンプルです。",
  highlights: "見どころのサンプルです。",
  production_story: "制作エピソードのサンプルです。",
  used_software: "After Effects / Blender",
  closing_comment: "ご視聴ありがとうございました。",
};

const SAMPLE_TEMPLATE = `{{title}}\n\n{{intro_comment}}\n\nイベント: {{event_title}}\n投稿者: {{creator_name}} {{creator_x_id}}\n楽曲: {{music}}\n\n{{credit}}\n\n{{youtube_url}}`;

const MEMBERS_LOOP_SAMPLE = `{{#members}}
{{member_chapter}} {{member_name}} @{{member_x_id}}
{{member_role}}
{{member_comment}}
{{/members}}`;

const SAMPLE_LOOP_MEMBERS: YoutubeDescriptionLoopMember[] = [
  {
    name: "Sample Member",
    x_user_id: "sample_member",
    role: "イラスト",
    comment: "背景を担当しました。",
    chapters: [{ time: "0:12" }, { time: "1:05" }],
  },
  {
    name: "Another Member",
    x_user_id: "another_member",
    role: "音響",
    comment: "",
    chapters: [],
  },
];

export function YoutubeDescriptionTemplateEditor({
  value,
  onChange,
  eventTitle,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  eventTitle?: string | null;
  disabled?: boolean;
}): React.ReactElement {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">("idle");
  const context = React.useMemo<YoutubeDescriptionContext>(
    () => ({
      ...SAMPLE_CONTEXT,
      event_title: eventTitle?.trim() || SAMPLE_CONTEXT.event_title,
    }),
    [eventTitle],
  );
  const rendered = React.useMemo(
    () =>
      renderYoutubeDescriptionTemplate(value, context, {
        members: SAMPLE_LOOP_MEMBERS,
      }),
    [context, value],
  );

  const setTextareaValue = React.useCallback((next: string, caret?: number) => {
    onChange(next);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      if (caret != null) textarea.setSelectionRange(caret, caret);
    });
  }, [onChange]);

  const insertVariable = (key: YoutubeDescriptionVariableKey) => {
    if (disabled) return;
    insertAtCursor(`{{${key}}}`);
  };

  const insertMembersLoop = () => {
    if (disabled) return;
    insertAtCursor(MEMBERS_LOOP_SAMPLE);
  };

  const insertAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setTextareaValue(`${value}${snippet}`);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    // 直前が行頭でない場合は改行を挟んで挿入し、loopブロックを見やすく保つ。
    const prefix =
      snippet.startsWith("{{#members}") && start > 0 && value[start - 1] !== "\n"
        ? "\n"
        : "";
    const next = `${value.slice(0, start)}${prefix}${snippet}${value.slice(end)}`;
    setTextareaValue(next, start + prefix.length + snippet.length);
  };

  const copyBody = async () => {
    if (disabled || !value) return;
    const ok = await writeTextToClipboard(value);
    if (!ok) {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2400);
      return;
    }
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <label className="fn-label" htmlFor="youtube_description_template">
          YouTube概要欄テンプレート
        </label>
        <p className="fn-text-muted-sm" style={{ margin: "6px 0 8px" }}>
          日本語の項目ボタンから変数を挿入できます。作品編集画面では実際の作品情報に置き換えてコピーできます。
        </p>
        <textarea
          ref={textareaRef}
          id="youtube_description_template"
          name="youtube_description_template"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="fn-input"
          rows={10}
          maxLength={MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH}
          disabled={disabled}
          placeholder="作品タイトルや投稿者情報を、下のボタンから組み立ててください。"
        />
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginTop: 6,
          }}
        >
          <span className="fn-text-muted-sm">
            {value.length.toLocaleString("ja-JP")} / {MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH.toLocaleString("ja-JP")}文字
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={disabled}
              onClick={() => setTextareaValue(SAMPLE_TEMPLATE)}
            >
              サンプルを挿入
            </button>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={disabled}
              onClick={insertMembersLoop}
            >
              メンバー繰り返しを挿入
            </button>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={disabled || !value}
              onClick={() => void copyBody()}
            >
              {copyState === "copied"
                ? "コピーしました"
                : copyState === "error"
                  ? "コピー失敗"
                  : "テンプレート本文をコピー"}
            </button>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={disabled || !value}
              onClick={() => setTextareaValue("")}
            >
              クリア
            </button>
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }} aria-label="概要欄に挿入できる項目">
        {VARIABLE_GROUPS.map((group) => (
          <section key={group.label} style={{ display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 12 }}>{group.label}</strong>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {group.keys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  disabled={disabled}
                  onClick={() => insertVariable(key)}
                  title={`{{${key}}}`}
                >
                  {VARIABLE_LABELS.get(key) ?? key}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section
        className="fn-card"
        style={{ padding: 12, display: "grid", gap: 8 }}
        aria-label="メンバー繰り返しの使い方"
      >
        <strong style={{ fontSize: 12 }}>
          {"メンバー繰り返し（{{#members}} ... {{/members}}）"}
        </strong>
        <p className="fn-text-muted-sm" style={{ margin: 0 }}>
          ブロック内は合作メンバーの人数だけ繰り返し出力されます（入力順・0人ならブロックごと消えます）。ネストはできません。
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={disabled}
            onClick={insertMembersLoop}
          >
            メンバー繰り返しを挿入
          </button>
        </div>
        <ul className="fn-text-muted-sm" style={{ margin: 0, paddingLeft: 18 }}>
          {[
            "member_index — メンバー番号（1始まり）",
            "member_name — 表示名",
            "member_x_id — X ID（@なし。@{{member_x_id}} のように書けます）",
            "member_chapter — 最初のチャプター時刻（例: 0:12）",
            "member_chapters — 全チャプター時刻（; 区切り、例: 0:12;1:05）",
            "member_role — 役職",
            "member_comment — コメント",
          ].map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="fn-card" style={{ padding: 12, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>ライブプレビュー</strong>
          <span className="fn-badge fn-badge-soft">サンプル値で表示</span>
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            font: "inherit",
            lineHeight: 1.7,
          }}
        >
          {rendered.text || "テンプレートを入力するとここに表示されます。"}
        </pre>
        {rendered.usedVariables.length > 0 ? (
          <p className="fn-text-muted-sm" style={{ margin: 0 }}>
            使用中: {rendered.usedVariables.map((key) => VARIABLE_LABELS.get(key) ?? key).join("、")}
          </p>
        ) : null}
        {rendered.unknownVariables.length > 0 ? (
          <p className="fn-alert fn-alert--danger" role="alert" style={{ margin: 0 }}>
            未登録の変数があります: {rendered.unknownVariables.map((key) => `{{${key}}}`).join("、")}
          </p>
        ) : null}
        {rendered.templateWarnings.length > 0 ? (
          <div className="fn-alert fn-alert--warning" role="status" style={{ margin: 0 }}>
            {rendered.templateWarnings.map((warning) => (
              <p key={warning} style={{ margin: "2px 0" }}>{warning}</p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
