// Auth pages: Entry (event reservation flow) + Settings (account / X ID)

const { useState: _exUseState } = React;

// ─── ENTRY (規約 → 連携 → 枠選択) ───────────────────────────────
function EntryPage({ onNav, lang }) {
  const events = window.FN_EVENTS;
  const [step, setStep] = _exUseState(3);
  const [agreed, setAgreed] = _exUseState(true);
  const [displayName, setDisplayName] = _exUseState("halo / loop");
  const [picked, setPicked] = _exUseState({ d: 1, h: 4 });

  const STEPS = [
    { n: 1, label: "規約確認", en: "Terms" },
    { n: 2, label: "アカウント連携", en: "Account" },
    { n: 3, label: "参加枠の選択", en: "Slot" },
  ];

  return (
    <main className="fn-main" data-screen-label="Entry">
      <div className="fn-wrap fn-entry">
        <header className="fn-entry-head">
          <span className="fn-eyebrow">イベント参加 — PVSF2025S</span>
          <h1 className="fn-display fn-entry-title">イベントにエントリー</h1>
          <span className="fn-jp fn-entry-sub">規約の確認、アカウント連携、参加枠の確保までを行います。</span>
        </header>

        <ol className="fn-stepper">
          {STEPS.map(s => (
            <li key={s.n} className={"fn-step " + (step === s.n ? "is-active" : step > s.n ? "is-done" : "")} onClick={() => setStep(s.n)}>
              <span className="fn-step-n fn-mono">{step > s.n ? "✓" : s.n}</span>
              <span className="fn-step-labels">
                <span className="fn-step-en fn-mono">{s.en}</span>
                <span className="fn-step-jp fn-jp">{s.label}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="fn-entry-body">
          {step === 1 && (
            <section className="fn-fsec">
              <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">01</span><div><h2 className="fn-fsec-title">利用規約・参加ガイド</h2><span className="fn-fsec-en fn-mono">TERMS v8.1</span></div></div></div>
              <div className="fn-fsec-body">
                <div className="fn-entry-terms fn-jp">
                  <p>・投稿者は YouTube 側の公開状態と権利状態を維持する責任を持ちます。</p>
                  <p>・スロット確保後、投稿期間内に作品を提出してください。未提出枠は自動解放されます。</p>
                  <p>・X ID 却下時は受付中イベントの未提出枠が解放され、元枠は24時間優先再取得できます。</p>
                  <p>・差し戻しの場合、再申請期限は7日。期限切れで voided になります。</p>
                </div>
                <label className="fn-checkbox">
                  <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                  <span className="fn-jp">最新の利用規約（v8.1）に同意します</span>
                </label>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="fn-fsec">
              <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">02</span><div><h2 className="fn-fsec-title">アカウント連携・表示名</h2><span className="fn-fsec-en fn-mono">ACCOUNT</span></div></div></div>
              <div className="fn-fsec-body">
                <div className="fn-entry-account">
                  <div className="fn-entry-xid">
                    <span className="fn-sb-saveid-avatar" style={{ width: 40, height: 40, fontSize: 18 }}>h</span>
                    <div>
                      <span className="fn-entry-xid-name">halo / loop</span>
                      <span className="fn-mono fn-entry-xid-handle">@halo_loop_v · 承認済み</span>
                    </div>
                    <span className="fn-pill" data-tone="ok">active</span>
                  </div>
                </div>
                <label className="fn-field">
                  <span className="fn-field-label">スロット公開名 / display_name<span className="fn-field-req">必須</span></span>
                  <input className="fn-input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="お祭りで公開される名前" />
                  <span className="fn-field-hint fn-jp">この名前がスロット公開ページに表示されます。</span>
                </label>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="fn-fsec">
              <div className="fn-fsec-head">
                <div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">03</span><div><h2 className="fn-fsec-title">参加枠の選択</h2><span className="fn-fsec-en fn-mono">SLOT</span></div></div>
                <div className="fn-row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <span className="fn-legend"><span className="fn-legend-swatch" data-kind="available" /><span className="fn-legend-label">空き</span></span>
                  <span className="fn-legend"><span className="fn-legend-swatch" data-kind="submitted" /><span className="fn-legend-label">確保済</span></span>
                </div>
              </div>
              <div className="fn-fsec-body">
                <EntrySlotGrid picked={picked} setPicked={setPicked} />
              </div>
            </section>
          )}

          <div className="fn-sb-actions">
            <span className="fn-sb-autosave fn-mono">自動保存済み</span>
            <div className="fn-sb-actions-right">
              {step > 1 && <button className="fn-btn" data-variant="ghost" onClick={() => setStep(s => s - 1)}>戻る</button>}
              {step < 3
                ? <button className="fn-btn" data-variant="accent" data-size="lg" disabled={step === 1 && !agreed} onClick={() => setStep(s => s + 1)}>次へ →</button>
                : <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("dashboard")}>この枠を確保する →</button>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function EntrySlotGrid({ picked, setPicked }) {
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;
  return (
    <div className="fn-slot-wrap">
      <table className="fn-slot">
        <thead>
          <tr>
            <th className="fn-slot-corner"></th>
            {days.map((d, i) => <th key={i} className="fn-slot-dayhead"><span className="fn-mono">{d}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {hours.map((h, hi) => (
            <tr key={h}>
              <th className="fn-slot-hourhead"><span className="fn-mono">{h}</span></th>
              {days.map((_, di) => {
                const cell = matrix[di][hi];
                const free = cell.status === "available";
                const isSel = picked.d === di && picked.h === hi;
                return (
                  <td key={di} className={"fn-slot-cell " + (isSel ? "is-selected" : "")} data-status={free ? "available" : "submitted"} onClick={() => free && setPicked({ d: di, h: hi })}>
                    <div className="fn-slot-cell-inner">
                      <span className="fn-slot-cell-name">{free ? "空き枠" : (cell.name ?? "確保済")}</span>
                      <span className="fn-slot-cell-status">{free ? "選択可" : "確保済"}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── SETTINGS (account / X ID / notifications) ──────────────────
function SettingsPage({ onNav, lang }) {
  const [nav, setNav] = _exUseState("account");
  const SECTIONS = [
    { id: "account", label: "アカウント" },
    { id: "xid", label: "X ID 管理" },
    { id: "profile", label: "プロフィール" },
    { id: "notify", label: "通知" },
    { id: "data", label: "データ" },
  ];
  return (
    <main className="fn-main" data-screen-label="Settings">
      <div className="fn-wrap fn-settings">
        <header className="fn-settings-head">
          <span className="fn-eyebrow">アカウント設定</span>
          <h1 className="fn-display fn-settings-title">設定</h1>
        </header>

        <div className="fn-settings-grid">
          <nav className="fn-settings-nav">
            {SECTIONS.map(s => (
              <button key={s.id} className={"fn-settings-nav-item " + (nav === s.id ? "is-active" : "")} onClick={() => setNav(s.id)}>{s.label}</button>
            ))}
          </nav>

          <div className="fn-settings-main">
            {nav === "account" && (
              <SettingsCard title="アカウント" en="ACCOUNT">
                <SetRow k="連携" v="X (Twitter) OAuth 2.0" />
                <SetRow k="ステータス" v="承認済み" tone="ok" />
                <SetRow k="プラン" v="クリエイター" />
                <div className="fn-settings-actions">
                  <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("login")}>サインアウト</button>
                </div>
              </SettingsCard>
            )}

            {nav === "xid" && (
              <SettingsCard title="X ID 管理" en="X IDENTITIES" desc="複数の X ID を保持し、作品の編集権限やクレジット入力に利用します。">
                <ul className="fn-xidlist">
                  <li className="fn-xidlist-row is-active">
                    <span className="fn-sb-saveid-avatar">h</span>
                    <div className="fn-xidlist-info"><span className="fn-xidlist-name">halo / loop</span><span className="fn-mono fn-xidlist-handle">@halo_loop_v</span></div>
                    <span className="fn-pill" data-tone="accent">active</span>
                    <span className="fn-pill" data-tone="ok">承認済み</span>
                  </li>
                  <li className="fn-xidlist-row">
                    <span className="fn-sb-saveid-avatar" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>l</span>
                    <div className="fn-xidlist-info"><span className="fn-xidlist-name">loop (sub)</span><span className="fn-mono fn-xidlist-handle">@loop_archive</span></div>
                    <button className="fn-btn" data-size="sm" data-variant="ghost">activeにする</button>
                    <span className="fn-pill" data-tone="ok">承認済み</span>
                  </li>
                  <li className="fn-xidlist-row">
                    <span className="fn-sb-saveid-avatar" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>n</span>
                    <div className="fn-xidlist-info"><span className="fn-xidlist-name">node test</span><span className="fn-mono fn-xidlist-handle">@node_test_</span></div>
                    <button className="fn-btn" data-size="sm" data-variant="ghost">activeにする</button>
                    <span className="fn-pill" data-tone="warn">承認待ち</span>
                  </li>
                </ul>
                <button className="fn-member-add">＋ X ID を追加で連携</button>
              </SettingsCard>
            )}

            {nav === "profile" && (
              <SettingsCard title="プロフィール" en="PROFILE">
                <div className="fn-field-grid">
                  <Field label="活動名 / チーム名"><input className="fn-input" defaultValue="halo / loop" /></Field>
                  <Field label="読み方"><input className="fn-input" defaultValue="ハロループ" /></Field>
                  <Field label="映像歴">
                    <select className="fn-input" defaultValue="3-5"><option value="0-1">〜1年</option><option value="1-3">1〜3年</option><option value="3-5">3〜5年</option><option value="5+">5年以上</option></select>
                  </Field>
                  <Field label="拠点"><input className="fn-input" defaultValue="東京" /></Field>
                  <Field label="紹介文" wide><textarea className="fn-input fn-textarea" defaultValue="夜と導線をテーマに個人制作。" /></Field>
                </div>
                <div className="fn-settings-actions"><button className="fn-btn" data-variant="accent">保存</button></div>
              </SettingsCard>
            )}

            {nav === "notify" && (
              <SettingsCard title="通知" en="NOTIFICATIONS">
                <SetToggle k="募集開始・締切リマインド" on />
                <SetToggle k="レビュー結果（承認 / 差し戻し）" on />
                <SetToggle k="フォロー・コメント" on={false} />
                <SetToggle k="運営からのお知らせ" on />
              </SettingsCard>
            )}

            {nav === "data" && (
              <SettingsCard title="データ" en="DATA / GDPR" desc="これまでの投稿・ポイント・連携情報を一括ダウンロードできます。">
                <SetRow k="投稿作品" v="22 件" />
                <SetRow k="連携 X ID" v="3 件" />
                <div className="fn-settings-actions">
                  <button className="fn-btn" data-variant="ghost" data-size="sm">JSON でエクスポート</button>
                  <button className="fn-btn fn-review-reject" data-size="sm">アカウント削除</button>
                </div>
              </SettingsCard>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function SettingsCard({ title, en, desc, children }) {
  return (
    <section className="fn-fsec">
      <div className="fn-fsec-head"><div className="fn-fsec-titles"><div><h2 className="fn-fsec-title">{title}</h2><span className="fn-fsec-en fn-mono">{en}</span></div></div></div>
      <div className="fn-fsec-body">
        {desc && <p className="fn-settings-desc fn-jp">{desc}</p>}
        {children}
      </div>
    </section>
  );
}

function SetRow({ k, v, tone }) {
  return (
    <div className="fn-set-row">
      <span className="fn-set-k fn-jp">{k}</span>
      {tone ? <span className="fn-pill" data-tone={tone}>{v}</span> : <span className="fn-set-v">{v}</span>}
    </div>
  );
}

function SetToggle({ k, on }) {
  const [v, setV] = _exUseState(on);
  return (
    <div className="fn-set-row">
      <span className="fn-set-k fn-jp">{k}</span>
      <button className={"fn-switch " + (v ? "is-on" : "")} onClick={() => setV(x => !x)} aria-label={k}><span className="fn-switch-knob" /></button>
    </div>
  );
}

// Local Field (babel scripts have isolated scope)
function Field({ label, required, wide, children }) {
  return (
    <label className={"fn-field " + (wide ? "fn-field-wide" : "")}>
      <span className="fn-field-label">{label}{required && <span className="fn-field-req">必須</span>}</span>
      {children}
    </label>
  );
}

Object.assign(window, { EntryPage, SettingsPage });
