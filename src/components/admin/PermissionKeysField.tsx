"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

type PermissionChoiceId = "basic" | "credits" | "descriptions" | "members";

const CHOICES: Array<{
  id: PermissionChoiceId;
  label: string;
  summary: string;
  icon: IconName;
  keys: string[];
}> = [
  {
    id: "basic",
    label: "タイトルと基本情報",
    summary: "タイトル、表示名、作品アイコンなど",
    icon: "edit",
    keys: ["video.basics", "videos.title"],
  },
  {
    id: "credits",
    label: "楽曲・クレジット",
    summary: "楽曲名、楽曲URL、クレジット表記",
    icon: "bookmark",
    keys: ["video.credits", "videos.music_credit"],
  },
  {
    id: "descriptions",
    label: "紹介文・制作コメント",
    summary: "紹介コメント、見どころ、制作エピソード、締めコメント",
    icon: "comment",
    keys: ["video.descriptions", "videos.review_data"],
  },
  {
    id: "members",
    label: "合作メンバー",
    summary: "メンバー、担当チャプター、メンバーコメント",
    icon: "users",
    keys: ["video.members", "video.member_chapters", "videos.members"],
  },
];

function parseSelectedIds(value: string | null | undefined): Set<PermissionChoiceId> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const keys = new Set(parsed.filter((v): v is string => typeof v === "string"));
    return new Set(
      CHOICES.filter((choice) => choice.keys.some((key) => keys.has(key))).map(
        (choice) => choice.id,
      ),
    );
  } catch {
    return new Set();
  }
}

function buildPermissionJson(selected: Set<PermissionChoiceId>): string {
  const keys = CHOICES.flatMap((choice) =>
    selected.has(choice.id) ? choice.keys : [],
  );
  return JSON.stringify(Array.from(new Set(keys)));
}

export function PermissionKeysField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string | null | undefined;
}): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<PermissionChoiceId>>(() =>
    parseSelectedIds(defaultValue),
  );

  const toggle = (id: PermissionChoiceId) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const value = buildPermissionJson(selected);
  const allSelected = selected.size === CHOICES.length;
  const selectedLabel =
    selected.size === 0
      ? "このイベントでは追加で編集できる項目はありません"
      : allSelected
        ? "すべての項目を編集できます"
        : `${selected.size}項目を編集できます`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name={name} value={value} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {CHOICES.map((choice) => {
          const checked = selected.has(choice.id);
          return (
            <label
              key={choice.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                gap: 10,
                alignItems: "flex-start",
                minHeight: 92,
                padding: "12px 13px",
                border: `1px solid ${
                  checked ? "var(--accent-primary)" : "var(--border-subtle)"
                }`,
                borderRadius: 10,
                background: checked
                  ? "linear-gradient(135deg, var(--accent-primary-soft), var(--bg-surface))"
                  : "var(--bg-surface)",
                boxShadow: checked ? "0 0 0 1px var(--accent-primary-soft) inset" : "none",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(choice.id)}
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 2,
                  accentColor: "var(--accent-primary)",
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                    color: checked ? "var(--accent-primary)" : "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  <Icon name={choice.icon} size={12} aria-hidden />
                  {checked ? "許可中" : "未許可"}
                </span>
                <span
                  style={{
                    display: "block",
                    color: "var(--text-primary)",
                    fontSize: 13.5,
                    fontWeight: 800,
                  }}
                >
                  {choice.label}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    color: "var(--text-muted)",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {choice.summary}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            color: "var(--text-muted)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {selectedLabel}
        </span>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => setSelected(new Set(CHOICES.map((choice) => choice.id)))}
          >
            <Icon name="check" size={11} aria-hidden />
            すべて選択
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => setSelected(new Set())}
          >
            <Icon name="x" size={11} aria-hidden />
            すべて解除
          </button>
        </span>
      </div>
    </div>
  );
}
