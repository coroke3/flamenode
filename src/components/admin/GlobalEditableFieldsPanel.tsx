"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { updateGlobalEditableFields } from "@/lib/actions/permissions-admin";

export type GlobalEditableFieldsSettings = {
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

const EDITABLE_FIELD_OPTIONS = [
  ["title", "タイトル"],
  ["display_name", "表示名"],
  ["icon_url", "アイコン"],
  ["music", "楽曲"],
  ["credit", "クレジット"],
  ["intro_comment", "紹介コメント"],
  ["used_software", "使用ソフト"],
  ["highlights", "見どころ"],
  ["production_story", "制作エピソード"],
  ["closing_comment", "締めコメント"],
  ["members", "メンバー"],
  ["chapters", "チャプター"],
] as const;

type EditableFieldKey = (typeof EDITABLE_FIELD_OPTIONS)[number][0];

const EDITABLE_FIELD_HELP: Record<EditableFieldKey, string> = {
  title: "作品タイトルを直せます",
  display_name: "作品ごとの作者名を直せます",
  icon_url: "作品ごとのアイコンを直せます",
  music: "使用楽曲名を直せます",
  credit: "クレジット表記を直せます",
  intro_comment: "冒頭の紹介文を直せます",
  used_software: "使用ソフト名を直せます",
  highlights: "見どころ欄を直せます",
  production_story: "制作エピソードを直せます",
  closing_comment: "あとがきを直せます",
  members: "合作メンバー一覧を直せます",
  chapters: "通常チャプターを直せます",
};

const EDITABLE_FIELD_GROUPS: Array<{
  label: string;
  description: string;
  fields: ReadonlyArray<readonly [EditableFieldKey, string]>;
}> = [
  {
    label: "基本情報",
    description: "作品の見出しや表示に関わる項目",
    fields: [
      ["title", "タイトル"],
      ["display_name", "表示名"],
      ["icon_url", "アイコン"],
    ],
  },
  {
    label: "本文・コメント",
    description: "作品の説明文・コメント類",
    fields: [
      ["music", "楽曲"],
      ["credit", "クレジット"],
      ["intro_comment", "紹介コメント"],
      ["used_software", "使用ソフト"],
      ["highlights", "見どころ"],
      ["production_story", "制作エピソード"],
      ["closing_comment", "締めコメント"],
    ],
  },
  {
    label: "構成情報",
    description: "メンバー・チャプターなど構造的な項目",
    fields: [
      ["members", "メンバー"],
      ["chapters", "チャプター"],
    ],
  },
];

export function GlobalEditableFieldsPanel({
  settings,
}: {
  settings: GlobalEditableFieldsSettings;
}): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const defaultSet = new Set(
    (settings.default_editable_fields ?? "").split(",").filter(Boolean),
  );
  const upcomingSet = new Set(
    (settings.upcoming_editable_fields ?? "").split(",").filter(Boolean),
  );
  const totalFields = EDITABLE_FIELD_OPTIONS.length;
  const scopes = [
    {
      key: "default",
      name: "default_editable_fields",
      label: "通常作品",
      badge: "通常",
      selected: defaultSet,
      tone: "primary" as const,
      description: "公開済み・通常状態の作品に適用します。",
    },
    {
      key: "upcoming",
      name: "upcoming_editable_fields",
      label: "公開前作品",
      badge: "公開前",
      selected: upcomingSet,
      tone: "warning" as const,
      description: "公開前・予約中の作品に適用します。",
    },
  ];

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await updateGlobalEditableFields(formData);
      if (!result.ok) {
        setError(result.message ?? "一般作品権限の保存に失敗しました。");
        return;
      }
      setSuccess(result.message ?? "一般作品権限を保存しました。");
      router.refresh();
    });
  };

  return (
    <section
      className="fn-card"
      style={{
        marginTop: 18,
        padding: 24,
        background: "var(--bg-surface)",
      }}
    >
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: 14,
          alignItems: "flex-start",
          marginBottom: 18,
        }}
      >
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 40,
            height: 40,
            border: "1px solid var(--accent-primary)",
            borderRadius: 12,
            color: "var(--accent-primary)",
            background: "var(--accent-primary-soft)",
          }}
        >
          <Icon name="settings" size={18} aria-hidden />
        </span>
        <div>
          <p
            style={{
              margin: "0 0 4px",
              color: "var(--accent-primary)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.12em",
            }}
          >
            GENERAL VIDEO PERMISSIONS
          </p>
          <h2 style={{ margin: 0, fontSize: 20 }}>一般作品権限</h2>
          <p className="fn-muted" style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.7 }}>
            一般ユーザーに開放する作品編集範囲の既定値です。通常作品と公開前作品で分けて設定します。
            イベント側で個別設定した場合は、そのイベントの設定が優先されます。
          </p>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          style={{ color: "var(--accent-danger)", fontSize: 12, marginBottom: 12 }}
        >
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <SaveSuccessNotice
          message={
            <>
              <Icon name="check" size={12} aria-hidden /> {success}
            </>
          }
          style={{ color: "var(--accent-primary)", fontSize: 12, marginBottom: 12 }}
        />
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {scopes.map((scope) => (
          <StatusSummary
            key={scope.key}
            label={scope.label}
            tone={scope.tone}
            selected={scope.selected}
            total={totalFields}
            description={scope.description}
          />
        ))}
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {EDITABLE_FIELD_GROUPS.map((group) => (
            <section
              key={group.label}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                background: "var(--bg-surface)",
                overflow: "hidden",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "var(--bg-base)",
                }}
              >
                <div>
                  <strong style={{ fontSize: 13 }}>{group.label}</strong>
                  <p className="fn-muted" style={{ margin: "3px 0 0", fontSize: 11.5 }}>
                    {group.description}
                  </p>
                </div>
                <span className="fn-badge fn-badge-soft">{group.fields.length}項目</span>
              </header>
              <div style={{ display: "grid" }}>
                {group.fields.map(([value, label]) => (
                  <div
                    key={value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      padding: "12px 14px",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ minWidth: 180 }}>
                      <span style={{ display: "block", fontWeight: 800, fontSize: 13 }}>
                        {label}
                      </span>
                      <span className="fn-muted" style={{ display: "block", fontSize: 11 }}>
                        {EDITABLE_FIELD_HELP[value]}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {scopes.map((scope) => (
                        <PermissionCheckbox
                          key={`${scope.key}-${value}`}
                          name={scope.name}
                          value={value}
                          checked={scope.selected.has(value)}
                          label={`${scope.label}で${label}を許可`}
                          scopeLabel={scope.badge}
                          tone={scope.tone}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
            チェックを外した項目は、作者または管理者だけが編集できます。
          </p>
          <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>
            <Icon name="check" size={12} aria-hidden />
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </section>
  );
}

function StatusSummary({
  label,
  tone,
  selected,
  total,
  description,
}: {
  label: string;
  tone: "primary" | "warning";
  selected: Set<string>;
  total: number;
  description: string;
}): React.ReactElement {
  const accentColor =
    tone === "warning" ? "var(--accent-warning, #d97706)" : "var(--accent-primary)";
  const ratio = total > 0 ? Math.round((selected.size / total) * 100) : 0;
  const enabledLabels = EDITABLE_FIELD_OPTIONS.filter(([value]) => selected.has(value)).map(
    ([, itemLabel]) => itemLabel,
  );
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--border-subtle)",
        borderTop: `3px solid ${accentColor}`,
        borderRadius: 12,
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Icon name={tone === "warning" ? "clock" : "check"} size={13} aria-hidden />
          {label}
        </strong>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            {selected.size}
          </span>
          {" / "}
          {total}
        </span>
      </div>
      <p className="fn-muted" style={{ margin: "4px 0 6px", fontSize: 11 }}>
        {description}
      </p>
      <div
        aria-hidden
        style={{
          height: 6,
          margin: "8px 0 10px",
          borderRadius: 999,
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${ratio}%`,
            height: "100%",
            borderRadius: 999,
            background: accentColor,
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
        現在の許可項目
      </div>
      {enabledLabels.length === 0 ? (
        <span className="fn-muted" style={{ fontSize: 11 }}>
          オーナー以外は編集不可
        </span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {enabledLabels.map((name) => (
            <span
              key={name}
              className="fn-badge fn-badge-soft"
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderColor: `color-mix(in srgb, ${accentColor} 40%, transparent)`,
                color: accentColor,
              }}
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionCheckbox({
  name,
  value,
  checked,
  label,
  scopeLabel,
  tone,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  scopeLabel: string;
  tone: "primary" | "warning";
}): React.ReactElement {
  const accentColor =
    tone === "warning" ? "var(--accent-warning, #d97706)" : "var(--accent-primary)";
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 32,
        padding: "6px 9px",
        border: `1px solid ${checked ? accentColor : "var(--border-subtle)"}`,
        borderRadius: 999,
        background: checked
          ? `color-mix(in srgb, ${accentColor} 13%, var(--bg-surface))`
          : "var(--bg-base)",
        color: checked ? "var(--text-primary)" : "var(--text-muted)",
        fontSize: 11,
        fontWeight: 800,
        cursor: "pointer",
      }}
      title={label}
    >
      <span className="fn-sr-only">{label}</span>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        style={{ width: 14, height: 14, accentColor }}
      />
      {scopeLabel}
    </label>
  );
}
