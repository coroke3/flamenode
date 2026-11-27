// Unmounted B01 port: keep CURRENT selection/profile state together for differential parity.
// The future host owns authority changes; server authorization remains independently enforced.
import * as React from "react";
import { normalizeXId } from "@flamenode/domain/xid";
import { Icon } from "../../routes/ui/Icon.tsx";

export interface XIdOption {
  id: string;
  x_name: string;
}

export function EditSubmitterField({
  initialXId,
  xIdOptions,
  hasSelectableXIds,
  selectedDefault,
  disabled,
  sectionDisabled,
  canChangeSubmitter,
  lockNoteId,
}: {
  initialXId: string;
  xIdOptions: readonly XIdOption[];
  hasSelectableXIds: boolean;
  selectedDefault: string;
  disabled: boolean;
  sectionDisabled: boolean;
  canChangeSubmitter: boolean;
  lockNoteId?: string;
}): React.ReactElement {
  const [unlocked, setUnlocked] = React.useState(false);
  const [selectedXId, setSelectedXId] = React.useState(selectedDefault);
  const [profileAction, setProfileAction] = React.useState<
    "keep" | "copy_default" | ""
  >("");

  const xIdChanged =
    unlocked && normalizeXId(selectedXId) !== normalizeXId(initialXId);

  React.useEffect(() => {
    if (!xIdChanged) setProfileAction("");
  }, [xIdChanged]);

  if (!initialXId && !hasSelectableXIds) {
    return (
      <div className="fn-muted fn-text-sm">提出主体 X ID が設定されていません。</div>
    );
  }

  // 非 admin (canChangeSubmitter === false) は unlock UI を一切出さず、
  // 既存の提出主体 X ID を読み取り専用で表示するだけ。
  if (!unlocked) {
    return (
      <>
        <input
          id="creator_x_user_id"
          name="creator_x_user_id"
          type="text"
          defaultValue={initialXId}
          className="fn-input"
          readOnly
          aria-readonly="true"
          disabled={sectionDisabled}
          aria-describedby={lockNoteId}
        />
        {canChangeSubmitter && hasSelectableXIds ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              fontSize: 11,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => setUnlocked(true)}
              disabled={disabled || sectionDisabled}
            />
            提出主体 X ID を変更する (管理者のみ)
          </label>
        ) : (
          <p className="fn-text-sm" style={{ marginTop: 4, color: "var(--text-muted)" }}>
            提出主体 X ID は変更できません。
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <input type="hidden" name="allow_submitter_change" value="1" />
      <select
        id="creator_x_user_id"
        name="creator_x_user_id"
        className="fn-select"
        value={selectedXId}
        onChange={(event) => setSelectedXId(event.currentTarget.value)}
        required
        disabled={disabled}
      >
        {xIdOptions.map((opt, index) => (
          <option
            key={`${opt.id}-xid-option-${index}`}
            value={normalizeXId(opt.id)}
          >
            @{opt.id} ({opt.x_name})
          </option>
        ))}
      </select>
      {xIdChanged ? (
        <fieldset
          style={{
            margin: "10px 0 0",
            padding: 12,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            display: "grid",
            gap: 8,
          }}
        >
          <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>
            提出者情報の扱い
          </legend>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="submitter_profile_action"
              value="keep"
              checked={profileAction === "keep"}
              onChange={() => setProfileAction("keep")}
              required
            />
            <span>
              <strong>提出者情報を維持</strong>
              <br />
              表示名・アイコン・概要などはこの作品の現状のまま残し、提出主体 X ID だけ変更します。
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="submitter_profile_action"
              value="copy_default"
              checked={profileAction === "copy_default"}
              onChange={() => setProfileAction("copy_default")}
              required
            />
            <span>
              <strong>新 X ID の既定を作品へコピー</strong>
              <br />
              変更先 X ID の既定プロフィールで、この作品の提出者情報を上書きします。
            </span>
          </label>
        </fieldset>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--accent-danger, #b91c1c)",
        }}
      >
        <Icon name="alert" size={11} aria-hidden />
        提出主体 X ID を変更しようとしています。サーバー側でも管理者権限を再検証します。
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setUnlocked(false)}
          style={{ marginLeft: "auto" }}
        >
          キャンセル
        </button>
      </div>
    </>
  );
}
