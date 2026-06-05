// Settings page — /dashboard/settings
// X ID is the public identity. Discord is auth only (read-only block below fold).

const { useState } = React;

const STATUS_META = {
  approved: { tone: "ok", icon: "fa-circle-check", label: "承認済み", dot: false },
  pending:  { tone: "warn", icon: null, label: "申請中", dot: true },
  rejected: { tone: "muted", icon: null, label: "却下", dot: true },
};

function SettingsStatusPill({ status, extra }) {
  const m = STATUS_META[status];
  return (
    <span className="fn-pill" data-tone={m.tone}>
      {m.dot ? <span className="fn-settings-pill-dot" aria-hidden="true">●</span> : null}
      {m.icon ? <i className={"fa-solid " + m.icon} aria-hidden="true"></i> : null}
      {extra || m.label}
    </span>
  );
}

function SettingsPage({ onNav }) {
  const [activeXIdx, setActiveXIdx] = useState(0);
  const [xIds, setXIds] = useState([
    {
      id: "halo_loop_v",
      x_name: "halo / loop",
      approval_status: "approved",
      display_name_override: "halo / loop",
      linked_at: "2025-03-14",
    },
    {
      id: "halo_loop_draft",
      x_name: null,
      approval_status: "pending",
      display_name_override: "",
      linked_at: "2025-07-28",
    },
    {
      id: "halo_loop_old",
      x_name: "halo (旧)",
      approval_status: "rejected",
      display_name_override: "",
      linked_at: "2025-06-01",
    },
  ]);
  const [pendingReqs, setPendingReqs] = useState([]);
  const [newHandle, setNewHandle] = useState("");
  const [addMsg, setAddMsg] = useState(null);
  const [editingXId, setEditingXId] = useState("halo_loop_v");
  const [iconPick, setIconPick] = useState(0);

  const activeX = xIds[activeXIdx];

  const submitRequest = () => {
    const h = newHandle.replace(/^@/, "").trim();
    if (!h || xIds.find((x) => x.id === h) || pendingReqs.find((r) => r.handle === h)) return;
    setPendingReqs((rs) => [...rs, { id: "req-" + Date.now(), handle: h, created_at: "今" }]);
    setNewHandle("");
    setAddMsg("申請を送信しました。運営の承認をお待ちください。");
    setTimeout(() => setAddMsg(null), 4000);
  };

  const deleteXId = (idx) => {
    if (idx === activeXIdx) return;
    const removed = xIds[idx];
    setXIds((ids) => ids.filter((_, i) => i !== idx));
    if (idx < activeXIdx) setActiveXIdx((a) => a - 1);
    if (editingXId === removed.id) setEditingXId(null);
  };

  return (
    <main className="fn-main" data-screen-label="Settings">
      <div className="fn-settings-wrap">
        <header className="fn-settings-hd">
          <button type="button" className="fn-cp-back fn-mono" onClick={() => onNav("dashboard")}>
            ← ダッシュボード
          </button>
          <h1 className="fn-display fn-settings-title">設定</h1>
          <p className="fn-jp fn-settings-lead">
            X ID 連携、アクティブ X ID の切替、Discord アカウント情報を管理します。
          </p>
        </header>

        {/* ── Active X ID ───────────────────────────────────── */}
        <section className="fn-settings-card fn-settings-card--accent" aria-labelledby="settings-active-h">
          <div className="fn-settings-card-hd">
            <h2 id="settings-active-h" className="fn-settings-card-title fn-display fn-settings-card-title--accent">
              アクティブ X ID
            </h2>
            <p className="fn-jp fn-settings-card-desc">
              ダッシュボード・作品クレジット・スロット表示に使われる名義です。
            </p>
          </div>
          {activeX && activeX.approval_status === "approved" ? (
            <div className="fn-settings-activex-panel">
              <div className="fn-settings-activex-avatar" aria-hidden="true">
                {activeX.id.charAt(0).toUpperCase()}
              </div>
              <div className="fn-settings-activex-id">
                <span className="fn-display fn-settings-activex-name">
                  {activeX.x_name || activeX.display_name_override || activeX.id}
                </span>
                <span className="fn-mono fn-settings-activex-handle">
                  <i className="fa-brands fa-x-twitter" aria-hidden="true"></i>
                  @{activeX.id}
                </span>
              </div>
              <div className="fn-settings-activex-badges">
                <span className="fn-pill" data-tone="accent">アクティブ</span>
                <SettingsStatusPill status="approved" />
              </div>
            </div>
          ) : (
            <div className="fn-settings-activex-panel fn-settings-activex-panel--empty">
              <p className="fn-jp">承認済みの X ID をアクティブに設定してください。</p>
            </div>
          )}
        </section>

        {/* ── Linked X IDs ──────────────────────────────────── */}
        <section className="fn-settings-card" aria-labelledby="settings-linked-h">
          <div className="fn-settings-card-hd">
            <h2 id="settings-linked-h" className="fn-settings-card-title fn-display">
              連携 X ID
            </h2>
            <p className="fn-jp fn-settings-card-desc">
              複数の X ID を連携できます。投稿や枠確保の名義はアクティブ X ID が使われます。
            </p>
          </div>

          <ul className="fn-settings-xid-list">
            {xIds.map((x, i) => {
              const isActive = i === activeXIdx;
              const isEditing = editingXId === x.id;
              const displayName = x.x_name || x.id;

              return (
                <li
                  key={x.id}
                  className={
                    "fn-settings-xid-row" +
                    (isActive ? " fn-settings-xid-row--active" : "") +
                    (isEditing ? " fn-settings-xid-row--editing" : "")
                  }
                >
                  <div className="fn-settings-xid-head">
                    <div className="fn-settings-xid-avatar" aria-hidden="true">
                      {x.id.charAt(0).toUpperCase()}
                    </div>
                    <div className="fn-settings-xid-info">
                      <span className="fn-display fn-settings-xid-name">{displayName}</span>
                      <span className="fn-mono fn-settings-xid-handle">
                        <i className="fa-brands fa-x-twitter" aria-hidden="true"></i>@{x.id}
                      </span>
                      <span className="fn-mono fn-settings-xid-date">{x.linked_at} 連携</span>
                    </div>
                    <div className="fn-settings-xid-badges">
                      <SettingsStatusPill status={x.approval_status} />
                      {isActive && x.approval_status === "approved" ? (
                        <span className="fn-pill" data-tone="accent">
                          <i className="fa-solid fa-star" aria-hidden="true"></i> アクティブ
                        </span>
                      ) : null}
                    </div>
                    <div className="fn-settings-xid-ops">
                      {x.approval_status === "approved" && !isActive ? (
                        <button
                          type="button"
                          className="fn-btn fn-settings-link-btn"
                          data-size="sm"
                          data-variant="ghost"
                          onClick={() => setActiveXIdx(i)}
                        >
                          アクティブに設定
                        </button>
                      ) : null}
                      {x.approval_status === "approved" && !isEditing ? (
                        <button
                          type="button"
                          className="fn-btn fn-settings-link-btn"
                          data-size="sm"
                          data-variant="ghost"
                          onClick={() => setEditingXId(x.id)}
                        >
                          プロフィール編集
                        </button>
                      ) : null}
                      {x.approval_status === "rejected" ? (
                        <button type="button" className="fn-btn fn-settings-link-btn" data-size="sm" data-variant="ghost">
                          再申請
                        </button>
                      ) : null}
                      {!isActive ? (
                        <button
                          type="button"
                          className="fn-btn fn-settings-link-btn fn-settings-link-btn--danger"
                          data-size="sm"
                          data-variant="ghost"
                          onClick={() => deleteXId(i)}
                        >
                          削除
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isEditing && x.approval_status === "approved" ? (
                    <div className="fn-settings-xid-edit">
                      <p className="fn-settings-xid-edit-title fn-jp">プロフィール編集</p>
                      <label className="fn-field">
                        <span className="fn-field-label fn-jp">
                          表示名オーバーライド（空欄で @ハンドル表示）
                        </span>
                        <input
                          className="fn-input"
                          defaultValue={x.display_name_override || x.x_name || ""}
                          placeholder={"@" + x.id}
                        />
                      </label>
                      <div className="fn-field">
                        <span className="fn-field-label fn-jp">
                          アイコン候補（作品サムネから自動取得）
                        </span>
                        <div className="fn-icon-thumbs fn-settings-icon-thumbs">
                          {[0, 1, 2, 3].map((j) => (
                            <button
                              key={j}
                              type="button"
                              className={"fn-icon-thumb " + (j === iconPick ? "is-active" : "")}
                              aria-label={"アイコン候補 " + (j + 1)}
                              aria-pressed={j === iconPick}
                              onClick={() => setIconPick(j)}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="fn-settings-xid-edit-actions">
                        <button
                          type="button"
                          className="fn-btn"
                          data-variant="ghost"
                          data-size="sm"
                          onClick={() => setEditingXId(null)}
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          className="fn-btn"
                          data-variant="accent"
                          data-size="sm"
                          onClick={() => setEditingXId(null)}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}

            {pendingReqs.map((r) => (
              <li key={r.id} className="fn-settings-xid-row fn-settings-xid-row--pending">
                <div className="fn-settings-xid-head">
                  <div className="fn-settings-xid-avatar fn-settings-xid-avatar--pending" aria-hidden="true">
                    ?
                  </div>
                  <div className="fn-settings-xid-info">
                    <span className="fn-mono fn-settings-xid-handle">
                      <i className="fa-brands fa-x-twitter" aria-hidden="true"></i>@{r.handle}
                    </span>
                    <span className="fn-mono fn-settings-xid-date">{r.created_at} 申請</span>
                  </div>
                  <div className="fn-settings-xid-badges">
                    <SettingsStatusPill status="pending" />
                  </div>
                  <div className="fn-settings-xid-ops">
                    <button
                      type="button"
                      className="fn-btn fn-settings-link-btn fn-settings-link-btn--danger"
                      data-size="sm"
                      data-variant="ghost"
                      onClick={() => setPendingReqs((rs) => rs.filter((x) => x.id !== r.id))}
                    >
                      申請取消
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="fn-settings-xid-add">
            <span className="fn-eyebrow fn-settings-add-label">新しい X ID を申請</span>
            <div className="fn-settings-xid-addrow">
              <div className="fn-xlink-input-wrap">
                <span className="fn-xlink-at fn-mono" aria-hidden="true">@</span>
                <input
                  className="fn-input fn-mono"
                  placeholder="x_handle"
                  value={newHandle}
                  onChange={(e) => setNewHandle(e.target.value.replace(/^@+/, ""))}
                  onKeyDown={(e) => e.key === "Enter" && submitRequest()}
                />
              </div>
              <button
                type="button"
                className="fn-btn"
                data-variant="accent"
                onClick={submitRequest}
                disabled={!newHandle.trim()}
              >
                申請する
              </button>
            </div>
            {addMsg ? (
              <p className="fn-settings-add-msg fn-jp" role="status">
                <i className="fa-solid fa-circle-check" aria-hidden="true"></i>
                {addMsg}
              </p>
            ) : null}
            <p className="fn-field-hint fn-jp fn-settings-add-hint">
              申請後は運営（管理者）が目視確認して承認します。
            </p>
          </div>
        </section>

        {/* ── Discord (read-only) ───────────────────────────── */}
        <section className="fn-settings-card" aria-labelledby="settings-discord-h">
          <div className="fn-settings-card-hd">
            <h2 id="settings-discord-h" className="fn-settings-card-title fn-display">Discord</h2>
            <p className="fn-jp fn-settings-card-desc">
              FlameNode のログインに使用しています。変更はできません。
            </p>
          </div>
          <div className="fn-settings-discord-badge">
            <span className="fn-settings-discord-avatar" aria-hidden="true">h</span>
            <div className="fn-settings-discord-id">
              <span className="fn-jp fn-settings-discord-name">halo / loop</span>
              <span className="fn-mono fn-settings-discord-meta">
                <i className="fa-brands fa-discord" aria-hidden="true"></i>
                halo#4821 · Discord ID
              </span>
            </div>
            <span className="fn-pill" data-tone="ok">接続済み</span>
          </div>
          <p className="fn-jp fn-settings-discord-note">
            Discord アカウントの変更・削除はできません。アカウントの削除をご希望の場合はお問い合わせください。
          </p>
        </section>

        <section className="fn-settings-card fn-settings-card--danger" aria-labelledby="settings-delete-h">
          <div className="fn-settings-card-hd">
            <h2 id="settings-delete-h" className="fn-settings-card-title fn-display">アカウントの削除</h2>
          </div>
          <p className="fn-jp fn-settings-danger-note">
            アカウントを削除すると、すべての X ID 連携・作品・枠・チャプターが削除されます。この操作は取り消せません。
          </p>
          <button type="button" className="fn-btn fn-settings-delete-btn" data-size="sm" data-variant="ghost">
            <i className="fa-solid fa-trash" aria-hidden="true"></i> アカウントを削除する
          </button>
        </section>
      </div>
    </main>
  );
}

Object.assign(window, { SettingsPage });
