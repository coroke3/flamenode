"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type PermissionChoiceId = "basic" | "credits" | "descriptions" | "members";

const CHOICES: Array<{
  id: PermissionChoiceId;
  label: string;
  summary: string;
  keys: string[];
}> = [
  {
    id: "basic",
    label: "タイトルと基本情報",
    summary: "作品タイトルなど、作品ページの見出しに出る情報",
    keys: ["video.basics", "videos.title"],
  },
  {
    id: "credits",
    label: "楽曲・クレジット",
    summary: "楽曲名、楽曲URL、クレジット表記",
    keys: ["video.credits", "videos.music_credit"],
  },
  {
    id: "descriptions",
    label: "紹介文・制作コメント",
    summary: "冒頭コメント、見どころ、制作裏話、権利確認欄",
    keys: ["video.descriptions", "videos.review_data"],
  },
  {
    id: "members",
    label: "合作メンバー",
    summary: "メンバー、担当範囲、メンバーコメント",
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

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name={name} value={value} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 8,
        }}
      >
        {CHOICES.map((choice) => {
          const checked = selected.has(choice.id);
          return (
            <label
              key={choice.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 9,
                alignItems: "flex-start",
                padding: "10px 11px",
                border: `1px solid ${checked ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-sm)",
                background: checked
                  ? "var(--accent-primary-soft)"
                  : "var(--bg-surface)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(choice.id)}
                style={{ marginTop: 3 }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {choice.label}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    color: "var(--text-muted)",
                    fontSize: 11.5,
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setSelected(new Set(CHOICES.map((choice) => choice.id)))}
        >
          <Icon name="check" size={11} aria-hidden />
          すべて選ぶ
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setSelected(new Set())}
        >
          <Icon name="x" size={11} aria-hidden />
          すべて外す
        </button>
        <span
          style={{
            alignSelf: "center",
            color: "var(--text-muted)",
            fontSize: 11.5,
          }}
        >
          {selected.size === 0
            ? "追加で編集できる項目はありません"
            : allSelected
              ? "すべての安全な項目を編集できます"
              : `${selected.size} 項目を編集できます`}
        </span>
      </div>
    </div>
  );
}
