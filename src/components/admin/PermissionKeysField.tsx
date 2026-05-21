"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * イベント単位の「ユーザーへ委譲する section_key」JSON フィールド。
 *
 * - テキストエリアの textarea に JSON 配列を表示。
 * - 下に「テンプレート」ボタンを並べ、ワンクリックで JSON を差し替えられる。
 * - 危険キー (videos.youtube_id 等) は許可リスト方式でサーバー側がフィルタするため、
 *   テンプレートには初めから入れない。
 */
const TEMPLATES: { label: string; description: string; keys: string[] }[] = [
  {
    label: "閲覧のみ",
    description: "委譲なし。空配列で保存。",
    keys: [],
  },
  {
    label: "作品情報編集",
    description: "タイトル / 楽曲クレジット / 紹介文系を委譲。",
    keys: [
      "videos.title",
      "videos.music_credit",
      "videos.review_data",
      "video.descriptions",
      "video.credits",
    ],
  },
  {
    label: "合作メンバー編集",
    description: "メンバー情報のみ委譲。",
    keys: ["videos.members", "video.members"],
  },
  {
    label: "共同運営",
    description: "作品情報 + メンバー編集まで委譲。",
    keys: [
      "videos.title",
      "videos.music_credit",
      "videos.review_data",
      "videos.members",
      "video.descriptions",
      "video.credits",
      "video.members",
    ],
  },
];

export function PermissionKeysField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string | null | undefined;
}): React.ReactElement {
  const [value, setValue] = React.useState<string>(() => defaultValue ?? "");

  const applyTemplate = (keys: string[]) => {
    setValue(JSON.stringify(keys, null, 2));
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <textarea
        name={name}
        className="fn-input"
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='["videos.title","videos.music_credit","videos.members","videos.review_data"]'
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            marginRight: 2,
          }}
        >
          テンプレ:
        </span>
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => applyTemplate(t.keys)}
            title={t.description}
            style={{ height: 22, fontSize: 11 }}
          >
            <Icon name="settings" size={10} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      <p
        className="fn-help"
        style={{ marginTop: 0, fontSize: 11, color: "var(--text-muted)" }}
      >
        利用可能な key: videos.title / videos.music_credit / videos.members /
        videos.review_data / video.descriptions / video.credits / video.members。
        危険キー (videos.youtube_id / videos.primary_event / video.identity)
        はサーバー側で除外されます。
      </p>
    </div>
  );
}
