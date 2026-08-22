"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import {
  GENERAL_EDITABLE_FIELD_GROUPS,
  GENERAL_EDITABLE_FIELD_KEYS,
  GENERAL_EDITABLE_FIELD_LABELS,
  parseGeneralEditableFields,
  type GeneralEditableFieldKey,
} from "@/lib/video/generalEditPermissions";

function parseSelectedFields(value: string | null | undefined): Set<GeneralEditableFieldKey> {
  return parseGeneralEditableFields(value);
}

function buildPermissionJson(selected: Set<GeneralEditableFieldKey>): string {
  return JSON.stringify(
    GENERAL_EDITABLE_FIELD_KEYS.filter((key) => selected.has(key)),
  );
}

export function PermissionKeysField({
  name,
  defaultValue,
  disabled = false,
}: {
  name: string;
  defaultValue: string | null | undefined;
  disabled?: boolean;
}): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<GeneralEditableFieldKey>>(() =>
    parseSelectedFields(defaultValue),
  );
  const value = buildPermissionJson(selected);

  const toggle = (key: GeneralEditableFieldKey, checked: boolean) => {
    if (disabled) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const allSelected = selected.size === GENERAL_EDITABLE_FIELD_KEYS.length;
  const selectedLabel =
    selected.size === 0
      ? "作品所有者はこのイベントで編集できません"
      : allSelected
        ? "作品所有者が編集できるすべての項目を許可"
        : `${selected.size}項目を作品所有者が編集できます`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name={name} value={value} />
      {GENERAL_EDITABLE_FIELD_GROUPS.map((group) => (
        <section key={group.label} style={{ display: "grid", gap: 8 }}>
          <div>
            <strong style={{ fontSize: 12 }}>{group.label}</strong>
            <p className="fn-muted" style={{ margin: "2px 0 0", fontSize: 11 }}>
              {group.description}
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 8,
            }}
          >
            {group.fields.map(([key]) => {
              const checked = selected.has(key);
              const label = GENERAL_EDITABLE_FIELD_LABELS[key];
              return (
                <label
                  key={key}
                  title={label}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    minHeight: 44,
                    padding: "9px 10px",
                    border: `1px solid ${checked ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    borderRadius: 9,
                    background: checked ? "var(--accent-primary-soft)" : "var(--bg-surface)",
                    opacity: disabled ? 0.65 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => toggle(key, event.target.checked)}
                    style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent-primary)" }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 750, lineHeight: 1.45 }}>
                    {label}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="fn-muted" style={{ fontSize: 12, fontWeight: 700 }}>{selectedLabel}</span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={disabled} onClick={() => setSelected(new Set(GENERAL_EDITABLE_FIELD_KEYS))}>
            <Icon name="check" size={11} aria-hidden /> すべて選択
          </button>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={disabled} onClick={() => setSelected(new Set())}>
            <Icon name="x" size={11} aria-hidden /> すべて解除
          </button>
        </span>
      </div>
    </div>
  );
}
