// Video edit page — /dashboard/edit/[id]
// Sections: privilege mode banner, video form, chapter composer, collab perms

const { useState: _edUs, useReducer: _edUr } = React;

// ─── Privilege mode banner ──────────────────────────────────────
function PrivilegeBanner({ mode, onSwitch }) {
  const banners = {
    normal: {
      style: { borderStyle: "dashed", borderColor: "var(--border-subtle)", color: "var(--text-muted)" },
      icon: "fa-circle-info",
      text: "通常編集モード（作品オーナー / 合作メンバーの権限のみ）",
      switches: [
        { label: "管理者権限で編集", mode: "admin" },
        { label: "イベント運営権限で編集", mode: "event" },
      ],
    },
    admin: {
      style: { borderColor: "var(--danger, #b91c1c)", background: "rgba(185,28,28,0.06)", color: "var(--danger, #b91c1c)" },
      icon: "fa-triangle-exclamation",
      text: "管理者権限で編集中。提出主体や所属イベントの変更が可能です。",
      switches: [
        { label: "イベント運営権限で編集", mode: "event" },
        { label: "通常モードへ戻る", mode: "normal" },
      ],
    },
    event: {
      style: { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--text-primary)" },
      icon: "fa-users",
      text: "イベント運営権限で編集中。",
      switches: [
        { label: "管理者権限で編集", mode: "admin" },
        { label: "通常モードへ戻る", mode: "normal" },
      ],
    },
  };
  const b = banners[mode];
  return (
    <div className="fn-edit-privilege" style={b.style}>
      <i className={"fa-solid " + b.icon} style={{ flexShrink: 0 }}></i>
      <span className="fn-jp">{b.text}</span>
      <div className="fn-edit-privilege-switches">
        {b.switches.map(sw => (
          <button key={sw.mode} className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onSwitch(sw.mode)}>
            {sw.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Chapter composer ────────────────────────────────────────────
function ChapterComposer({ chapters, onUpdate }) {
  const [editing, setEditing] = _edUs(null); // index of chapter being edited
  const [newTime, setNewTime] = _edUs("");
  const [newLabel, setNewLabel] = _edUs("");

  const fmt = sec => String(Math.floor(sec / 60)).padStart(2,"0") + ":" + String(Math.floor(sec % 60)).padStart(2,"0");
  const parseSec = str => {
    const [m, s] = str.split(":").map(Number); return (m || 0) * 60 + (s || 0);
  };

  const add = () => {
    if (!newTime || !newLabel) return;
    const t = parseSec(newTime);
    const updated = [...chapters, { time: t, label: newLabel, visibility: "public" }]
      .sort((a, b) => a.time - b.time);
    onUpdate(updated);
    setNewTime(""); setNewLabel("");
  };

  const remove = i => onUpdate(chapters.filter((_, j) => j !== i));
  const toggleVis = i => onUpdate(chapters.map((c, j) => j === i ? { ...c, visibility: c.visibility === "public" ? "private" : "public" } : c));

  return (
    <div className="fn-chap-composer">
      <ol className="fn-chap-list">
        {chapters.map((c, i) => (
          <li key={i} className={"fn-chap-row " + (c.visibility !== "public" ? "fn-chap-row--private" : "")}>
            <span className="fn-mono fn-chap-time">{fmt(c.time)}</span>
            {editing === i ? (
              <input
                className="fn-input fn-chap-input-label"
                defaultValue={c.label}
                autoFocus
                onBlur={e => {
                  onUpdate(chapters.map((ch, j) => j === i ? { ...ch, label: e.target.value } : ch));
                  setEditing(null);
                }}
                onKeyDown={e => e.key === "Enter" && e.target.blur()}
              />
            ) : (
              <span className="fn-chap-label fn-jp" onClick={() => setEditing(i)}>{c.label}</span>
            )}
            <div className="fn-chap-row-actions">
              <button
                className={"fn-chap-vis-btn fn-mono " + (c.visibility === "public" ? "is-public" : "is-private")}
                onClick={() => toggleVis(i)}
                title={c.visibility === "public" ? "公開中 → 非公開へ" : "非公開 → 公開へ"}
              >
                {c.visibility === "public" ? <i className="fa-solid fa-eye"></i> : <i className="fa-solid fa-eye-slash"></i>}
              </button>
              <button className="fn-chap-del-btn" onClick={() => remove(i)} aria-label="削除">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="fn-chap-add">
        <input
          className="fn-input fn-mono fn-chap-add-time"
          placeholder="00:00"
          value={newTime}
          onChange={e => setNewTime(e.target.value)}
          style={{ width: 72 }}
        />
        <input
          className="fn-input fn-chap-add-label"
          placeholder="チャプター名"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          style={{ flex: 1 }}
        />
        <button className="fn-btn" data-variant="accent" onClick={add}>追加</button>
      </div>
    </div>
  );
}

// ─── Collab perms manager ────────────────────────────────────────
function CollabPermsManager({ members, onAdd, onRemove, onToggle }) {
  const [handle, setHandle] = _edUs("");
  const submit = () => {
    if (!handle.trim()) return;
    onAdd(handle.replace(/^@/, "").trim());
    setHandle("");
  };
  return (
    <div className="fn-collab">
      <ul className="fn-collab-list">
        {members.map((m, i) => (
          <li key={i} className="fn-collab-row">
            <span className="fn-vcard-avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{m.name.charAt(0)}</span>
            <div className="fn-collab-id">
              <span className="fn-collab-name">{m.name}</span>
              <span className="fn-mono fn-collab-handle"><i className="fa-brands fa-x-twitter"></i> @{m.handle}</span>
            </div>
            <label className="fn-collab-perm fn-mono">
              <input type="checkbox" checked={m.canEdit} onChange={() => onToggle(i, "canEdit")} />
              共同編集
            </label>
            <label className="fn-collab-perm fn-mono">
              <input type="checkbox" checked={m.isPublic} onChange={() => onToggle(i, "isPublic")} />
              クレジット表示
            </label>
            <button className="fn-chap-del-btn" onClick={() => onRemove(i)} aria-label="削除">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </li>
        ))}
      </ul>
      <div className="fn-collab-add">
        <div className="fn-xlink-input-wrap" style={{ flex: 1 }}>
          <span className="fn-xlink-at fn-mono">@</span>
          <input
            className="fn-input fn-mono"
            style={{ paddingLeft: 32 }}
            placeholder="x_handle"
            value={handle}
            onChange={e => setHandle(e.target.value.replace(/^@+/, ""))}
            onKeyDown={e => e.key === "Enter" && submit()}
          />
        </div>
        <button className="fn-btn" data-variant="accent" onClick={submit}>
          メンバーを追加
        </button>
      </div>
      <p className="fn-field-hint fn-jp">X ハンドルで追加。FlameNode に登録済みのユーザーのみ有効です。</p>
    </div>
  );
}

// ─── Main edit page ─────────────────────────────────────────────
function VideoEditPage({ onNav, selectedVideo }) {
  const videos = window.FN_VIDEOS;
  const video = videos.find(v => v.id === selectedVideo) || videos[2];
  const chapters = [...window.FN_CHAPTERS];
  const [mode, setMode] = _edUs("normal");
  const [title, setTitle] = _edUs(video.title);
  const [hitokoto, setHitokoto] = _edUs("夜の導線をなぞるように。");
  const [chaps, setChaps] = _edUs(chapters);
  const [members, setMembers] = _edUs([
    { name: "frame index", handle: "frame_index__", canEdit: true,  isPublic: true },
    { name: "KAI",         handle: "kai_node",      canEdit: false, isPublic: true },
  ]);
  const [saved, setSaved] = _edUs(false);

  const addMember = handle => {
    if (members.find(m => m.handle === handle)) return;
    setMembers(ms => [...ms, { name: handle, handle, canEdit: false, isPublic: true }]);
  };
  const removeMember = i => setMembers(ms => ms.filter((_, j) => j !== i));
  const toggleMember = (i, key) => setMembers(ms => ms.map((m, j) => j === i ? { ...m, [key]: !m[key] } : m));

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  return (
    <main className="fn-main fn-vd" data-screen-label="VideoEdit">
      <div className="fn-wrap">
        {/* Breadcrumb */}
        <div className="fn-edit-breadcrumb fn-mono">
          <button className="fn-cp-back" onClick={() => onNav("dashboard")}>← ダッシュボード</button>
          <span>›</span>
          <span style={{ color: "var(--text-primary)" }}>{video.title}</span>
          <span>›</span>
          <span style={{ color: "var(--text-muted)" }}>編集</span>
          <span className="fn-edit-breadcrumb-right">
            <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("video", { video: video.id })}>
              <i className="fa-solid fa-arrow-up-right-from-square"></i> サイトで見る
            </button>
          </span>
        </div>

        <PrivilegeBanner mode={mode} onSwitch={setMode} />

        <div className="fn-edit-grid">
          {/* Left: forms */}
          <div className="fn-edit-left">

            {/* Video info */}
            <section className="fn-edit-section">
              <h2 className="fn-edit-section-title fn-display">基本情報</h2>
              <div className="fn-edit-fields">
                <label className="fn-field">
                  <span className="fn-field-label">作品タイトル<span className="fn-field-req">必須</span></span>
                  <input className="fn-input" value={title} onChange={e => setTitle(e.target.value)} />
                </label>
                <label className="fn-field">
                  <span className="fn-field-label">ひとこと（30文字まで）</span>
                  <div className="fn-input-counted">
                    <input className="fn-input" value={hitokoto} maxLength={30} onChange={e => setHitokoto(e.target.value)} />
                    <span className="fn-input-count fn-mono">{hitokoto.length}/30</span>
                  </div>
                </label>
                <label className="fn-field">
                  <span className="fn-field-label">YouTube URL</span>
                  <input className="fn-input fn-mono" defaultValue={"https://youtu.be/" + (video.id)} />
                  <span className="fn-field-hint fn-jp">変更後は YouTube 同期が再実行されます。</span>
                </label>
                {mode !== "normal" && (
                  <label className="fn-field">
                    <span className="fn-field-label">
                      {mode === "admin" ? "提出主体 X ID（管理者のみ）" : "所属イベント（運営のみ）"}
                    </span>
                    <input className="fn-input fn-mono" defaultValue={mode === "admin" ? "@halo_loop_v" : video.event} />
                    <span className="fn-field-hint fn-jp" style={{ color: mode === "admin" ? "var(--danger, #b91c1c)" : "var(--accent)" }}>
                      {mode === "admin" ? "管理者権限が必要な操作です。慎重に。" : "イベント運営権限で変更可能です。"}
                    </span>
                  </label>
                )}
              </div>
            </section>

            {/* Chapters */}
            <section className="fn-edit-section">
              <div className="fn-edit-section-head">
                <h2 className="fn-edit-section-title fn-display">チャプター</h2>
                <span className="fn-mono fn-edit-section-count">{chaps.length} 件</span>
              </div>
              <p className="fn-field-hint fn-jp" style={{ marginBottom: 12 }}>時間（mm:ss）とラベルを入力して追加。クリックでラベル編集。目のアイコンで公開/非公開を切替。</p>
              <ChapterComposer chapters={chaps} onUpdate={setChaps} />
            </section>

            {/* Collab */}
            <section className="fn-edit-section">
              <h2 className="fn-edit-section-title fn-display">合作メンバー</h2>
              <p className="fn-field-hint fn-jp" style={{ marginBottom: 12 }}>
                「共同編集」をオンにしたメンバーはこのページを編集できます。「クレジット表示」はサイト上の作品ページに名前が表示されます。
              </p>
              <CollabPermsManager members={members} onAdd={addMember} onRemove={removeMember} onToggle={toggleMember} />
            </section>

          </div>

          {/* Right: status */}
          <aside className="fn-edit-aside">
            <div className="fn-edit-aside-card">
              <span className="fn-eyebrow">ステータス</span>
              <div className="fn-edit-status-rows fn-mono">
                <div><span className="fn-review-k">公開状態</span><span className="fn-pill" data-tone="ok">公開中</span></div>
                <div><span className="fn-review-k">YouTube</span><span>同期済み</span></div>
                <div><span className="fn-review-k">イベント</span><span>{video.event.toUpperCase()}</span></div>
                <div><span className="fn-review-k">チャプター</span><span>{chaps.length} 件</span></div>
                <div><span className="fn-review-k">メンバー</span><span>{members.length} 名</span></div>
              </div>
              <div className="fn-edit-aside-actions">
                <button className="fn-btn" data-variant="accent" data-size="lg" style={{ width: "100%" }} onClick={save}>
                  {saved ? <><i className="fa-solid fa-check"></i> 保存しました</> : "変更を保存 →"}
                </button>
                <button className="fn-btn" data-variant="ghost" style={{ width: "100%" }} onClick={() => onNav("dashboard")}>
                  キャンセル
                </button>
              </div>
            </div>
            <div className="fn-edit-aside-card">
              <span className="fn-eyebrow">操作ログ</span>
              <ul className="fn-edit-log fn-mono">
                {[
                  { t: "19:42", who: "@halo_loop_v", act: "タイトル変更" },
                  { t: "18:30", who: "@halo_loop_v", act: "チャプター追加 (3件)" },
                  { t: "15:11", who: "@frame_index__", act: "メンバー追加" },
                ].map((l, i) => (
                  <li key={i} className="fn-edit-log-row">
                    <span className="fn-edit-log-time">{l.t}</span>
                    <span className="fn-edit-log-who">{l.who}</span>
                    <span className="fn-edit-log-act">{l.act}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { VideoEditPage });
