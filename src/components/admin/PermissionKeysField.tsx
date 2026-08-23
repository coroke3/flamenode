"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import {
  GENERAL_EDITABLE_FIELD_GROUPS,
  GENERAL_EDITABLE_FIELD_KEYS,
  GENERAL_EDITABLE_FIELD_LABELS,
  parseGeneralEditableFields,
  parseGeneralEditablePolicyV2,
  type GeneralEditableFieldKey,
} from "@/lib/video/generalEditPermissions";

type PolicyState = "allow" | "deny" | "inherit";

function buildPermissionJson(
  states: ReadonlyMap<GeneralEditableFieldKey, PolicyState>,
): string {
  return JSON.stringify({
    version: 2,
    fallback: "inherit",
    allow: GENERAL_EDITABLE_FIELD_KEYS.filter((key) => states.get(key) === "allow"),
    deny: GENERAL_EDITABLE_FIELD_KEYS.filter((key) => states.get(key) === "deny"),
    inherit: GENERAL_EDITABLE_FIELD_KEYS.filter((key) => states.get(key) === "inherit"),
  });
}

function initialPolicyStates(
  value: string | null | undefined,
  allowUserVideoEdits: number | undefined,
): Map<GeneralEditableFieldKey, PolicyState> {
  const states = new Map<GeneralEditableFieldKey, PolicyState>();
  for (const key of GENERAL_EDITABLE_FIELD_KEYS) states.set(key, "inherit");
  const raw = value?.trim() ?? "";
  const policy = parseGeneralEditablePolicyV2(raw);
  if (policy) {
    // Preserve the policy fallback for fields omitted from the explicit
    // lists.  Otherwise editing a valid `fallback: "deny"` policy would
    // display those fields as inherited and the next save could silently
    // broaden permissions to the global policy.
    const omittedState: PolicyState = policy.fallback === "deny" ? "deny" : "inherit";
    for (const key of GENERAL_EDITABLE_FIELD_KEYS) states.set(key, omittedState);
    for (const key of policy.allow) states.set(key, "allow");
    for (const key of policy.deny) states.set(key, "deny");
    for (const key of policy.inherit) states.set(key, "inherit");
    return states;
  }
  // Do not rewrite an untouched legacy array. If it is edited, the next
  // render switches to an explicit v2 policy with the same effective values.
  if (allowUserVideoEdits === 1 && raw && !raw.startsWith("{")) {
    const selected = parseGeneralEditableFields(raw);
    for (const key of GENERAL_EDITABLE_FIELD_KEYS) {
      states.set(key, selected.has(key) ? "allow" : "deny");
    }
  } else if (allowUserVideoEdits === 1) {
    // Legacy allow=1 with an empty, malformed, or unknown document resolved
    // to an empty set on the server.  Show that effective state instead of
    // silently presenting global inheritance and broadening permissions when
    // an operator edits one field.
    for (const key of GENERAL_EDITABLE_FIELD_KEYS) states.set(key, "deny");
  }
  return states;
}

export function PermissionKeysField({
  name,
  defaultValue,
  disabled = false,
  allowUserVideoEdits,
}: {
  name: string;
  defaultValue: string | null | undefined;
  disabled?: boolean;
  allowUserVideoEdits?: number;
}): React.ReactElement {
  const [states, setStates] = React.useState<Map<GeneralEditableFieldKey, PolicyState>>(() =>
    initialPolicyStates(defaultValue, allowUserVideoEdits),
  );
  const [dirty, setDirty] = React.useState(false);
  const value = dirty ? buildPermissionJson(states) : (defaultValue ?? "");

  const setState = (key: GeneralEditableFieldKey, state: PolicyState) => {
    if (disabled) return;
    setDirty(true);
    setStates((current) => {
      const next = new Map(current);
      next.set(key, state);
      return next;
    });
  };

  const setAll = (state: PolicyState) => {
    if (disabled) return;
    setDirty(true);
    setStates(() => {
      const next = new Map<GeneralEditableFieldKey, PolicyState>();
      for (const key of GENERAL_EDITABLE_FIELD_KEYS) next.set(key, state);
      return next;
    });
  };

  const allowedCount = Array.from(states.values()).filter((state) => state === "allow").length;
  const inheritedCount = Array.from(states.values()).filter((state) => state === "inherit").length;
  const summary = `${allowedCount}項目を許可 / ${inheritedCount}項目をグローバル設定から継承`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name={name} value={value} />
      <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
        各項目を「継承 / 許可 / 拒否」から選択できます。既存の配列形式は、変更するまでそのまま保存されます。
      </p>
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
              const state = states.get(key) ?? "inherit";
              const label = GENERAL_EDITABLE_FIELD_LABELS[key];
              return (
                <label
                  key={key}
                  title={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    minHeight: 44,
                    padding: "9px 10px",
                    border: `1px solid ${state === "allow" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    borderRadius: 9,
                    background: state === "allow" ? "var(--accent-primary-soft)" : "var(--bg-surface)",
                    opacity: disabled ? 0.65 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 750, lineHeight: 1.45 }}>
                    {label}
                  </span>
                  <select
                    aria-label={`${label} policy`}
                    value={state}
                    disabled={disabled}
                    onChange={(event) => setState(key, event.target.value as PolicyState)}
                  >
                    <option value="inherit">継承</option>
                    <option value="allow">許可</option>
                    <option value="deny">拒否</option>
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="fn-muted" style={{ fontSize: 12, fontWeight: 700 }}>{summary}</span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={disabled} onClick={() => setAll("allow")}>
            <Icon name="check" size={11} aria-hidden /> すべて許可
          </button>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={disabled} onClick={() => setAll("inherit")}>
            <Icon name="x" size={11} aria-hidden /> すべて継承
          </button>
        </span>
      </div>
    </div>
  );
}
