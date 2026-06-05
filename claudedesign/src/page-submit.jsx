// Submission form — slotted post. High-density, data-entry-optimized.
// Covers the full field set from dashboard/post spec.

const { useState: _sbUseState } = React;

function SubmitPage({ onNav, lang }) {
  const events = window.FN_EVENTS;
  const creators = window.FN_CREATORS;
  const selEvent = events[0];

  const [step, setStep] = _sbUseState(1);
  const [subType, setSubType] = _sbUseState("collab"); // individual | collab | mixed
  const [members, setMembers] = _sbUseState([
    { id: "m1", name: "halo / loop", handle: "@halo_loop_v", role: "Direction / Edit", comment: "全体構成・編集", match: "active", open: true },
    { id: "m2", name: "KAI", handle: "@kai_node", role: "Music", comment: "", match: "exact", open: false },
    { id: "m3", name: "frame index", handle: "@frame_index__", role: "Motion (asst.)", comment: "", match: "similar", open: false },
  ]);
  const [software, setSoftware] = _sbUseState(["After Effects", "Premiere Pro", "Blender"]);
  const [memberInputMode, setMemberInputMode] = _sbUseState("normal"); // normal | csv
  const [ytStatus, setYtStatus] = _sbUseState("verified"); // verifying | verified | failed | idle
  const [url, setUrl] = _sbUseState("https://youtu.be/_node0426");
  const [title, setTitle] = _sbUseState("結節線");
  const [hitokoto, setHitokoto] = _sbUseState("夜の導線をなぞるように。");
  const [saveModal, setSaveModal] = _sbUseState(false);
  const ytId = (url.match(/[\w-]{6,}$/) || ["_node0426"])[0];

  const STEPS = [
    { n: 1, label: "基本情報", en: "Entry" },
    { n: 2, label: "合作メンバー", en: "Members" },
    { n: 3, label: "YouTube・詳細", en: "Details" },
    { n: 4, label: "確認", en: "Review" },
  ];
  const showMembers = subType !== "individual";

  const addMember = () => setMembers(m => [...m, { id: "m" + Date.now(), name: "", handle: "", role: "", comment: "", match: "manual", open: true }]);
  const removeMember = (id) => setMembers(m => m.filter(x => x.id !== id));
  const updateMember = (id, patch) => setMembers(m => m.map(x => x.id === id ? { ...x, ...patch } : x));
  const toggleMember = (id) => setMembers(m => m.map(x => x.id === id ? { ...x, open: !x.open } : x));

  return (
    <main className="fn-main" data-screen-label="Submit">
      <div className="fn-wrap fn-sb">
        {/* Header */}
        <header className="fn-sb-head">
          <div>
            <span className="fn-eyebrow">submit — 作品投稿 / 枠あり</span>
            <h1 className="fn-display fn-sb-title">作品を投稿する</h1>
            <span className="fn-jp fn-sb-sub">確保済みスロットに作品情報を登録し、運営レビューへ提出します。</span>
          </div>
          <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("dashboard")}>← マイページ</button>
        </header>

        {/* Reapply warning band (state-driven) */}
        <div className="fn-sb-warn">
          <span className="fn-sb-warn-icon" aria-hidden="true">!</span>
          <div className="fn-sb-warn-body">
            <span className="fn-sb-warn-title fn-jp">前回の提出は差し戻されています</span>
            <span className="fn-sb-warn-text fn-jp">楽曲クレジットの記載を確認してください。修正後に再提出すると審査待ちに戻ります。</span>
          </div>
          <button className="fn-btn" data-size="sm" data-variant="ghost">詳細</button>
        </div>

        {/* Locked slot tile */}
        <div className="fn-sb-slot">
          <div className="fn-sb-slot-cell">
            <span className="fn-eyebrow">参加イベント</span>
            <span className="fn-sb-slot-v">{selEvent.title}</span>
            <span className="fn-mono fn-sb-slot-sub">{selEvent.code}</span>
          </div>
          <div className="fn-sb-slot-divider" />
          <div className="fn-sb-slot-cell">
            <span className="fn-eyebrow">確保スロット</span>
            <span className="fn-sb-slot-v fn-mono">08/30 (Sat) 21:00</span>
            <span className="fn-mono fn-sb-slot-sub">slot #PVSF-S048 · 単枠</span>
          </div>
          <div className="fn-sb-slot-divider" />
          <div className="fn-sb-slot-cell">
            <span className="fn-eyebrow">提出締切</span>
            <span className="fn-sb-slot-v fn-mono">あと 6 日</span>
            <span className="fn-mono fn-sb-slot-sub">08/31 23:59 まで</span>
          </div>
          <span className="fn-pill fn-sb-slot-lock" data-tone="muted">確保済み · 変更不可</span>
        </div>

        {/* Stepper */}
        <ol className="fn-stepper">
          {STEPS.map(s => {
            const disabled = s.n === 2 && !showMembers;
            return (
              <li key={s.n} className={"fn-step " + (step === s.n ? "is-active" : step > s.n ? "is-done" : "") + (disabled ? " is-disabled" : "")} onClick={() => !disabled && setStep(s.n)}>
                <span className="fn-step-n fn-mono">{step > s.n ? "✓" : s.n}</span>
                <span className="fn-step-labels">
                  <span className="fn-step-jp fn-jp">{disabled ? "スキップ" : s.label}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="fn-sb-grid">
          <div className="fn-sb-form">
            {step === 1 && (
              <Step1Entry
                subType={subType} setSubType={setSubType}
                title={title} setTitle={setTitle}
                hitokoto={hitokoto} setHitokoto={setHitokoto}
                creators={creators}
              />
            )}
            {step === 2 && (
              <Step2Members
                members={members} addMember={addMember} removeMember={removeMember}
                updateMember={updateMember} toggleMember={toggleMember}
                mode={memberInputMode} setMode={setMemberInputMode}
              />
            )}
            {step === 3 && (
              <Step3Details
                url={url} setUrl={setUrl} ytStatus={ytStatus} setYtStatus={setYtStatus}
                ytId={ytId} software={software} setSoftware={setSoftware}
              />
            )}
            {step === 4 && (
              <Step4Review
                title={title} selEvent={selEvent} members={members} showMembers={showMembers}
                software={software} ytId={ytId} subType={subType}
              />
            )}

            {/* Footer nav */}
            <div className="fn-sb-actions">
              <span className="fn-sb-autosave fn-mono">自動保存済み · 19:42</span>
              <div className="fn-sb-actions-right">
                {step > 1 && <button className="fn-btn" data-variant="ghost" onClick={() => setStep(s => (s === 3 && !showMembers ? 1 : s - 1))}>戻る</button>}
                {step < 4
                  ? <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => setStep(s => (s === 1 && !showMembers ? 3 : s + 1))}>次へ →</button>
                  : <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => setSaveModal(true)}>提出する →</button>}
              </div>
            </div>
          </div>

          {/* Sticky preview rail */}
          <aside className="fn-sb-preview">
            <span className="fn-eyebrow">live preview</span>
            <div className="fn-sb-preview-card">
              <div className="fn-sb-preview-thumb">
                <div className="fn-sb-preview-thumb-bg" />
                <div className="fn-thumb-grid" aria-hidden="true" />
                <span className="fn-mono fn-sb-preview-code">{selEvent.code}</span>
                <div className="fn-player-center-play" aria-hidden="true" style={{ width: 52, height: 52 }}>
                  <svg width="20" height="20" viewBox="0 0 28 28"><path d="M6 4 L24 14 L6 24 Z" fill="currentColor"/></svg>
                </div>
              </div>
              <div className="fn-sb-preview-body">
                <h3 className="fn-sb-preview-title">{title || "（タイトル未入力）"}</h3>
                <span className="fn-sb-preview-hito fn-jp">{hitokoto || "ひとこと未入力"}</span>
                <span className="fn-mono fn-sb-preview-meta">yt · {ytId}</span>
              </div>
            </div>

            <dl className="fn-sb-checklist">
              <ChecklistItem ok label="スロット確保済み" />
              <ChecklistItem ok={ytStatus === "verified"} label={ytStatus === "verified" ? "YouTube 同期確認済み" : "YouTube 未確認"} />
              <ChecklistItem ok={!!title} label={title ? "タイトル入力済み" : "タイトル未入力"} />
              <ChecklistItem ok={!showMembers || members.length > 0} label="メンバー登録" />
              <ChecklistItem warn label="楽曲クレジット要確認" />
              <ChecklistItem pending label="運営レビュー待ち" />
            </dl>

            <div className="fn-sb-saveid">
              <span className="fn-eyebrow">保存名義 / active X ID</span>
              <div className="fn-sb-saveid-row">
                <span className="fn-sb-saveid-avatar">h</span>
                <span className="fn-mono fn-sb-saveid-handle">@halo_loop_v</span>
                <button className="fn-link fn-sb-saveid-change">変更</button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {saveModal && (
        <SaveConfirmModal onClose={() => setSaveModal(false)} onConfirm={() => { setSaveModal(false); onNav("dashboard"); }} />
      )}
    </main>
  );
}

// ─── Step 1: Entry ──────────────────────────────────────────────
function Step1Entry({ subType, setSubType, title, setTitle, hitokoto, setHitokoto, creators }) {
  return (
    <div className="fn-sb-step">
      <FormSection num="01" title="参加区分">
        <div className="fn-radio-cards">
          {[
            { id: "individual", label: "個人", desc: "1名で制作" },
            { id: "collab", label: "複数人", desc: "合作・チーム" },
            { id: "mixed", label: "混合", desc: "個人＋ゲスト" },
          ].map(o => (
            <button key={o.id} className={"fn-radio-card " + (subType === o.id ? "is-active" : "")} onClick={() => setSubType(o.id)}>
              <span className="fn-radio-card-dot" aria-hidden="true" />
              <span className="fn-radio-card-label">{o.label}</span>
              <span className="fn-radio-card-desc fn-jp">{o.desc}</span>
            </button>
          ))}
        </div>
      </FormSection>

      <FormSection num="02" title="クリエイター情報">
        <div className="fn-field-grid">
          <Field label="活動名・チーム名" required>
            <input className="fn-input" defaultValue="halo / loop" placeholder="表示名" />
          </Field>
          <Field label="読み方 (フリガナ)">
            <input className="fn-input" defaultValue="ハロループ" placeholder="ひらがな・カタカナ" />
          </Field>
          <Field label="X (Twitter) ID" required>
            <input className="fn-input fn-mono" defaultValue="@halo_loop_v" />
          </Field>
          <Field label="映像歴">
            <select className="fn-input" defaultValue="3-5">
              <option value="0-1">〜1年</option>
              <option value="1-3">1〜3年</option>
              <option value="3-5">3〜5年</option>
              <option value="5+">5年以上</option>
            </select>
          </Field>
        </div>

        <Field label="アイコン画像">
          <div className="fn-icon-picker">
            <div className="fn-icon-current">h</div>
            <div className="fn-icon-history">
              <span className="fn-field-hint fn-jp">過去のアイコンから選択 / 履歴</span>
              <div className="fn-icon-thumbs">
                {[0,1,2,3].map(i => <button key={i} className={"fn-icon-thumb " + (i === 0 ? "is-active" : "")} aria-label="icon" />)}
                <button className="fn-icon-thumb fn-icon-upload" aria-label="upload">＋</button>
              </div>
            </div>
          </div>
        </Field>
      </FormSection>

      <FormSection num="03" title="作品基本情報">
        <div className="fn-field-grid">
          <Field label="作品タイトル" required wide>
            <input className="fn-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="作品タイトル" />
          </Field>
          <Field label="使用楽曲名">
            <input className="fn-input" defaultValue="Node" placeholder="曲名" />
          </Field>
          <Field label="楽曲作者名">
            <input className="fn-input" defaultValue="KAI" placeholder="アーティスト" />
          </Field>
          <Field label="楽曲 URL" wide>
            <input className="fn-input fn-mono" defaultValue="https://youtu.be/kai_node_src" placeholder="https://" />
          </Field>
        </div>
        <Field label="ひとこと（30文字まで）">
          <div className="fn-input-counted">
            <input className="fn-input" value={hitokoto} maxLength={30} onChange={e => setHitokoto(e.target.value)} placeholder="作品紹介を一言" />
            <span className="fn-input-count fn-mono">{hitokoto.length}/30</span>
          </div>
        </Field>
      </FormSection>
    </div>
  );
}

// ─── Step 2: Members ────────────────────────────────────────────
function Step2Members({ members, addMember, removeMember, updateMember, toggleMember, mode, setMode }) {
  return (
    <div className="fn-sb-step">
      <FormSection num="04" title="合作メンバー"
        aside={
          <div className="fn-tabs-mini">
            <button className={mode === "normal" ? "is-active" : ""} onClick={() => setMode("normal")}>通常入力</button>
            <button className={mode === "csv" ? "is-active" : ""} onClick={() => setMode("csv")}>CSV入力</button>
          </div>
        }>
        {mode === "normal" ? (
          <>
            <div className="fn-member-search">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5"/><path d="M9.5 9.5 L12.5 12.5"/></svg>
              <input className="fn-member-search-input fn-mono" placeholder="名前 / @ID であいまい検索（カンマ区切り・貼り付け対応）" />
              <span className="fn-field-hint fn-member-search-hint fn-jp">名前↔ID 双方向サジェスト</span>
            </div>

            <ul className="fn-member-list">
              {members.map((m, i) => (
                <li key={m.id} className="fn-member-row">
                  <div className="fn-member-head" onClick={() => toggleMember(m.id)}>
                    <span className="fn-member-handle-drag" aria-hidden="true">⠿</span>
                    <span className="fn-member-no fn-mono">{String(i + 1).padStart(2, "0")}</span>
                    <div className="fn-member-id">
                      <input className="fn-input fn-input-sm fn-member-name" value={m.name} placeholder="名前" onClick={e => e.stopPropagation()} onChange={e => updateMember(m.id, { name: e.target.value })} />
                      <input className="fn-input fn-input-sm fn-mono fn-member-handle" value={m.handle} placeholder="@handle" onClick={e => e.stopPropagation()} onChange={e => updateMember(m.id, { handle: e.target.value })} />
                    </div>
                    <span className={"fn-member-match fn-match-" + m.match}>{matchLabel(m.match)}</span>
                    <span className="fn-member-role-preview">{m.role || "役職未設定"}</span>
                    <button className="fn-member-remove" onClick={e => { e.stopPropagation(); removeMember(m.id); }} aria-label="remove">×</button>
                  </div>
                  {m.open && (
                    <div className="fn-member-detail">
                      <Field label="役職 / Role">
                        <input className="fn-input fn-input-sm" value={m.role} placeholder="例: Direction / Music / Motion" onChange={e => updateMember(m.id, { role: e.target.value })} />
                      </Field>
                      <Field label="コメント / Comment">
                        <input className="fn-input fn-input-sm" value={m.comment} placeholder="担当・ひとこと" onChange={e => updateMember(m.id, { comment: e.target.value })} />
                      </Field>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <button className="fn-member-add" onClick={addMember}>＋ メンバーを追加（未登録名も可）</button>
          </>
        ) : (
          <div className="fn-csv">
            <div className="fn-csv-head">
              <span className="fn-field-hint fn-jp">1行 = 1名。「名前, @ID, 役職, コメント」の順でカンマ区切り。</span>
              <button className="fn-btn" data-size="sm" data-variant="ghost">CSV作成プロンプトをコピー</button>
            </div>
            <textarea className="fn-input fn-csv-area fn-mono" defaultValue={"halo / loop, @halo_loop_v, Direction, 全体構成\nKAI, @kai_node, Music,\nframe index, @frame_index__, Motion, アシスト"} />
            <div className="fn-csv-foot">
              <button className="fn-btn" data-size="sm" data-variant="ghost">追記</button>
              <button className="fn-btn" data-size="sm" data-variant="accent">サジェストへ取り込む</button>
            </div>
          </div>
        )}
      </FormSection>
    </div>
  );
}

function matchLabel(m) {
  return { active: "本人", exact: "完全一致", partial: "部分一致", similar: "類似", alias: "旧ID", history: "履歴", manual: "新規" }[m] || m;
}

// ─── Step 3: Details ────────────────────────────────────────────
function Step3Details({ url, setUrl, ytStatus, setYtStatus, ytId, software, setSoftware }) {
  const removeSw = (s) => setSoftware(list => list.filter(x => x !== s));
  return (
    <div className="fn-sb-step">
      <FormSection num="05" title="YouTube 連携">
        <Field label="YouTube URL または ID" required>
          <div className="fn-yt-input">
            <input className="fn-input fn-mono" value={url} onChange={e => { setUrl(e.target.value); setYtStatus("verifying"); }} placeholder="https://youtu.be/... / shorts / watch?v=" />
            <button className="fn-btn" data-size="sm" onClick={() => setYtStatus("verified")}>同期</button>
          </div>
          <div className={"fn-yt-status fn-yt-" + ytStatus}>
            {ytStatus === "verified" && <><span className="fn-yt-dot" />確認済み · 公開 · 04:18 · ID {ytId}</>}
            {ytStatus === "verifying" && <><span className="fn-yt-dot" />同期中…</>}
            {ytStatus === "failed" && <><span className="fn-yt-dot" />取得失敗 · YouTube側の公開設定を確認してください<button className="fn-link">再試行</button></>}
          </div>
          <span className="fn-field-hint fn-jp">通常 / Shorts / 共有 URL を 11桁 ID に正規化。手動同期は1日1回（JST 0:00 リセット）。</span>
        </Field>
      </FormSection>

      <FormSection num="06" title="使用編集ソフト"
        aside={<div className="fn-tabs-mini"><button className="is-active">通常入力</button><button>CSV入力</button></div>}>
        <div className="fn-chips-input">
          {software.map(s => (
            <span key={s} className="fn-chip">
              {s}<button className="fn-chip-x" onClick={() => removeSw(s)} aria-label="remove">×</button>
            </span>
          ))}
          <input className="fn-chip-add fn-mono" placeholder="追加してEnter" onKeyDown={e => { if (e.key === "Enter" && e.target.value) { setSoftware(l => [...l, e.target.value]); e.target.value = ""; } }} />
        </div>
      </FormSection>

      <FormSection num="07" title="イベント固有質問">
        <Field label="この作品のテーマ（PVSF2025S 設問）">
          <input className="fn-input" placeholder="イベントの設問に回答" defaultValue="夜と導線" />
        </Field>
        <Field label="上映時の注意事項（点滅・音量など）">
          <textarea className="fn-input fn-textarea" placeholder="該当があれば記入" defaultValue="中盤に短いフラッシュあり。" />
        </Field>
      </FormSection>

      <FormSection num="08" title="振り返り・コメント">
        <div className="fn-field-grid">
          <Field label="紹介コメント" wide>
            <textarea className="fn-input fn-textarea" placeholder="作品紹介" />
          </Field>
          <Field label="制作コメント" wide>
            <textarea className="fn-input fn-textarea" placeholder="制作の振り返り（任意・後日入力可）" />
          </Field>
        </div>
      </FormSection>
    </div>
  );
}

// ─── Step 4: Review ─────────────────────────────────────────────
function Step4Review({ title, selEvent, members, showMembers, software, ytId, subType }) {
  const typeLabel = { individual: "個人", collab: "複数人", mixed: "混合" }[subType];
  return (
    <div className="fn-sb-step">
      <FormSection num="09" title="提出内容の確認">
        <dl className="fn-review-summary">
          <Row k="参加イベント" v={`${selEvent.title} (${selEvent.code})`} />
          <Row k="スロット" v="08/30 (Sat) 21:00 · 単枠" />
          <Row k="参加区分" v={typeLabel} />
          <Row k="作品タイトル" v={title || "（未入力）"} />
          <Row k="YouTube ID" v={ytId} mono />
          <Row k="使用楽曲" v="Node / KAI" />
          {showMembers && <Row k="合作メンバー" v={`${members.length}名 — ${members.map(m => m.name).join(" / ")}`} />}
          <Row k="使用編集ソフト" v={software.join(" · ")} />
          <Row k="保存名義" v="@halo_loop_v" mono />
        </dl>
        <div className="fn-review-consent">
          <label className="fn-checkbox">
            <input type="checkbox" defaultChecked />
            <span className="fn-jp">最新の利用規約（v8.1）に同意します</span>
          </label>
          <span className="fn-field-hint fn-jp">提出と同時にスロットが submitted になり、運営レビュー（pending）へ入ります。</span>
        </div>
      </FormSection>
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────
function FormSection({ num, title, en, aside, children }) {
  return (
    <section className="fn-fsec">
      <div className="fn-fsec-head">
        <div className="fn-fsec-titles">
          <span className="fn-fsec-num fn-mono">{num}</span>
          <div>
            <h2 className="fn-fsec-title">{title}</h2>
            <span className="fn-fsec-en fn-mono">{en}</span>
          </div>
        </div>
        {aside}
      </div>
      <div className="fn-fsec-body">{children}</div>
    </section>
  );
}

function Field({ label, required, wide, children }) {
  return (
    <label className={"fn-field " + (wide ? "fn-field-wide" : "")}>
      <span className="fn-field-label">{label}{required && <span className="fn-field-req">必須</span>}</span>
      {children}
    </label>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="fn-review-summary-row">
      <dt>{k}</dt>
      <dd className={mono ? "fn-mono" : ""}>{v}</dd>
    </div>
  );
}

function ChecklistItem({ ok, warn, pending, label }) {
  const cls = ok ? "is-ok" : warn ? "is-warn" : "is-pending";
  const mark = ok ? "✓" : warn ? "!" : "○";
  return <div className={cls}><dt>{mark}</dt><dd className="fn-jp">{label}</dd></div>;
}

function SaveConfirmModal({ onClose, onConfirm }) {
  return (
    <div className="fn-modal-scrim" onClick={onClose}>
      <div className="fn-modal" onClick={e => e.stopPropagation()}>
        <span className="fn-eyebrow">保存名義の確認</span>
        <h2 className="fn-display fn-modal-title">このX IDで提出しますか？</h2>
        <div className="fn-modal-id">
          <span className="fn-sb-saveid-avatar">h</span>
          <div>
            <span className="fn-modal-id-handle fn-mono">@halo_loop_v</span>
            <span className="fn-modal-id-sub fn-jp">active X ID · 承認済み</span>
          </div>
        </div>
        <p className="fn-modal-text fn-jp">提出すると作品は <strong>審査待ち（pending）</strong> になり、スロットは <strong>submitted</strong> に更新されます。</p>
        <div className="fn-modal-actions">
          <button className="fn-btn" data-variant="ghost" onClick={onClose}>キャンセル</button>
          <button className="fn-btn" data-variant="accent" data-size="lg" onClick={onConfirm}>このIDで提出 →</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SubmitPage });
