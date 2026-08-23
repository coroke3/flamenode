"use client";

import * as React from "react";
import styles from "./YoutubeDescriptionTemplateEditor.module.css";
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
  // 実フォームと同じく scalar のX IDは @ なし。必要ならテンプレート側で @ を付ける。
  creator_x_id: "sample_creator",
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

const MEMBERS_LOOP_SAMPLE = `{{#members}}
{{member_chapter}} {{member_name}} @{{member_x_id}}
{{member_role}}
{{member_comment}}
{{/members}}`;

const PRESETS = [
  {
    id: "simple",
    label: "シンプル",
    body: `{{title}}\n\n{{intro_comment}}\n\n{{creator_name}} @{{creator_x_id}}\n{{youtube_url}}`,
  },
  {
    id: "event",
    label: "イベント標準",
    body: `{{title}}\n\n{{intro_comment}}\n\nイベント: {{event_title}}\n部: {{part}}\n投稿者: {{creator_name}} @{{creator_x_id}}\n楽曲: {{music}}\n使用ソフト: {{used_software}}\n\n{{credit}}\n\n{{youtube_url}}`,
  },
  {
    id: "collab",
    label: "合作",
    body: `{{title}}\n\n{{intro_comment}}\n\nイベント: {{event_title}}\n代表: {{creator_name}} @{{creator_x_id}}\n\n共同制作者\n{{#members}}\n- {{member_name}} @{{member_x_id}} {{member_role}}\n{{member_comment}}\n{{/members}}\n\n楽曲: {{music}}\n{{credit}}`,
  },
  {
    id: "collab-chapter",
    label: "合作＋チャプター",
    body: `{{title}}\n\n{{intro_comment}}\n\nイベント: {{event_title}}\n代表: {{creator_name}} @{{creator_x_id}}\n\n共同制作者 / チャプター\n{{#members}}\n{{member_chapter}} {{member_name}} @{{member_x_id}}\n{{member_role}}\n{{member_comment}}\n{{/members}}\n\n楽曲: {{music}}\n{{credit}}`,
  },
] as const;

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
  const [previewCopyState, setPreviewCopyState] = React.useState<
    "idle" | "copied" | "error"
  >("idle");
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

  React.useEffect(() => {
    setPreviewCopyState("idle");
  }, [rendered.text]);

  const setTextareaValue = React.useCallback(
    (next: string, caret?: number) => {
      // maxLength はユーザー入力には効くが、ボタンによる文字列挿入には効かない。
      // サーバー側上限を超える値をUIから生成しないよう、ここでも同じ上限に揃える。
      const bounded = next.slice(0, MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH);
      const boundedCaret =
        caret == null ? undefined : Math.min(caret, bounded.length);
      onChange(bounded);
      setCopyState("idle");
      setPreviewCopyState("idle");
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        if (boundedCaret != null) {
          textarea.setSelectionRange(boundedCaret, boundedCaret);
        }
      });
    },
    [onChange],
  );

  const insertAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setTextareaValue(`${value}${snippet}`);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const prefix =
      snippet.startsWith("{{#members}") && start > 0 && value[start - 1] !== "\n"
        ? "\n"
        : "";
    const next = `${value.slice(0, start)}${prefix}${snippet}${value.slice(end)}`;
    setTextareaValue(next, start + prefix.length + snippet.length);
  };

  const insertVariable = (key: YoutubeDescriptionVariableKey) => {
    if (disabled) return;
    insertAtCursor(`{{${key}}}`);
  };

  const insertMembersLoop = () => {
    if (disabled) return;
    insertAtCursor(MEMBERS_LOOP_SAMPLE);
  };

  const applyPreset = (body: string, label: string) => {
    if (disabled) return;
    if (
      value.trim() &&
      !window.confirm(`現在のテンプレートを「${label}」プリセットで置き換えますか？`)
    ) {
      return;
    }
    setTextareaValue(body);
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

  const copyRenderedPreview = async () => {
    if (!rendered.text) return;
    const ok = await writeTextToClipboard(rendered.text);
    if (!ok) {
      setPreviewCopyState("error");
      window.setTimeout(() => setPreviewCopyState("idle"), 2400);
      return;
    }
    setPreviewCopyState("copied");
    window.setTimeout(() => setPreviewCopyState("idle"), 1800);
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <label className="fn-label" htmlFor="youtube_description_template">
          YouTube概要欄テンプレート
        </label>
        <p className={styles.description}>
          日本語の項目ボタンから変数を挿入できます。右側で実際の出力例を確認しながら編集できます。
        </p>
      </div>

      <div className={styles.presetBar} aria-label="概要欄テンプレートのプリセット">
        <span className={styles.presetLabel}>プリセット</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={disabled}
            onClick={() => applyPreset(preset.body, preset.label)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={styles.workspace}>
        <div className={styles.editorColumn}>
          <div>
            <textarea
              ref={textareaRef}
              id="youtube_description_template"
              name="youtube_description_template"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={`fn-input ${styles.textarea}`}
              maxLength={MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH}
              disabled={disabled}
              placeholder="作品タイトルや投稿者情報を、下のボタンから組み立ててください。"
            />
            <div className={styles.textareaMeta}>
              <span className="fn-text-muted-sm">
                {value.length.toLocaleString("ja-JP")} / {MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH.toLocaleString("ja-JP")}文字
              </span>
              <div className={styles.actions}>
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
                  onClick={() => {
                    if (!window.confirm("現在のテンプレートを空にしますか？")) return;
                    setTextareaValue("");
                  }}
                >
                  クリア
                </button>
              </div>
            </div>
          </div>

          <div className={styles.variableGroups} aria-label="概要欄に挿入できる項目">
            {VARIABLE_GROUPS.map((group) => (
              <section key={group.label} className={styles.variableGroup}>
                <strong className={styles.variableGroupTitle}>{group.label}</strong>
                <div className={styles.variableButtons}>
                  {group.keys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.variableButton}`}
                      disabled={disabled}
                      onClick={() => insertVariable(key)}
                      title={`{{${key}}}`}
                    >
                      <span>{VARIABLE_LABELS.get(key) ?? key}</span>
                      <span className={styles.variableToken}>{`{{${key}}}`}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section
            className={`fn-card ${styles.helpCard}`}
            aria-label="メンバー繰り返しの使い方"
          >
            <strong style={{ fontSize: 12 }}>
              {"メンバー繰り返し（{{#members}} ... {{/members}}）"}
            </strong>
            <p className="fn-text-muted-sm">
              ブロック内は合作メンバーの人数だけ繰り返し出力されます。0人ならブロックごと消え、ネストはできません。
            </p>
            <ul className="fn-text-muted-sm" style={{ paddingLeft: 18 }}>
              {[
                "member_index — メンバー番号（1始まり）",
                "member_name — 表示名",
                "member_x_id — X ID（@なし）",
                "member_chapter — 最初のチャプター時刻",
                "member_chapters — 全チャプター時刻",
                "member_role — 役職",
                "member_comment — コメント",
              ].map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </section>
        </div>

        <aside className={styles.previewColumn} aria-label="概要欄テンプレートのプレビュー">
          <section className={`fn-card ${styles.previewCard}`}>
            <div className={styles.previewHead}>
              <strong>ライブプレビュー</strong>
              <span className="fn-badge fn-badge-soft">サンプル値で表示</span>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                disabled={!rendered.text}
                onClick={() => void copyRenderedPreview()}
              >
                {previewCopyState === "copied"
                  ? "出力例をコピーしました"
                  : previewCopyState === "error"
                    ? "コピー失敗"
                    : "出力例をコピー"}
              </button>
            </div>
            <pre className={styles.previewText}>
              {rendered.text || "テンプレートを入力するとここに表示されます。"}
            </pre>
            {rendered.usedVariables.length > 0 ? (
              <p className="fn-text-muted-sm">
                使用中: {rendered.usedVariables.map((key) => VARIABLE_LABELS.get(key) ?? key).join("、")}
              </p>
            ) : null}
          </section>

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
        </aside>
      </div>
    </div>
  );
}
