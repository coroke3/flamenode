// Dashboard (creator account) + Admin (event management / approval queue)

const { useState: _dUseState } = React;

// ─── DASHBOARD ──────────────────────────────────────────────────
function Dashboard({ onNav, lang }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const me = creators[2]; // halo / loop
  const myVideos = videos.slice(0, 6);
  const [tab, setTab] = _dUseState("videos");

  const NOTIFICATIONS = [
    { icon: "fa-circle-check", tone: "ok",   text: "「結節線」が承認され公開されました",           time: "19:42", sub: "PVSF2025S" },
    { icon: "fa-user-plus",    tone: "muted", text: "frame index があなたをフォローしました",        time: "18:11", sub: null },
    { icon: "fa-comment",      tone: "muted", text: "rin_otsuka_ が「夜更けの導線」にメモを追加",   time: "14:03", sub: "07/25" },
    { icon: "fa-triangle-exclamation", tone: "warn", text: "「Pale Index」楽曲クレジット要確認",    time: "12:30", sub: "差し戻し" },
    { icon: "fa-calendar",     tone: "muted", text: "NCNC2025 のエントリー受付が開始しました",      time: "00:00", sub: "09/01" },
    { icon: "fa-circle-check", tone: "ok",   text: "X ID @halo_loop_v が承認されました",             time: "07/20", sub: null },
    { icon: "fa-circle-xmark", tone: "warn",  text: "X ID @negativecue_old が却下されました",        time: "07/19", sub: "優先再取得可能" },
  ];

  return (
    <main className="fn-main" data-screen-label="Dashboard">
      <div className="fn-wrap fn-dash">
        {/* Account header */}
        <header className="fn-dash-head">
          <div className="fn-dash-id">
            <div className="fn-dash-avatar">{me.name.charAt(0)}</div>
            <div className="fn-dash-id-text">
              <span className="fn-eyebrow">my account</span>
              <h1 className="fn-display fn-dash-name">{me.name}</h1>
              <span className="fn-mono fn-dash-handle">@{me.handle}</span>
            </div>
          </div>
          <div className="fn-dash-actions">
            <button className="fn-btn" data-variant="ghost" onClick={() => onNav("admin")}>運営コンソール</button>
            <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("post")}>＋ 投稿する</button>
          </div>
        </header>

        {/* KPI row */}
        <div className="fn-dash-kpis">
          {[
            { k: "公開作品", en: "videos", v: me.videos, sub: "+2 this month" },
            { k: "総再生", en: "total plays", v: "84.2k", sub: "+12.4% MoM" },
            { k: "フォロワー", en: "followers", v: "1,206", sub: "+38" },
            { k: "確保中の枠", en: "reserved slots", v: "03", sub: "PVSF2025S" },
          ].map((kpi, i) => (
            <div key={i} className="fn-dash-kpi">
              <span className="fn-eyebrow">{kpi.en}</span>
              <span className="fn-display fn-dash-kpi-v">{kpi.v}</span>
              <span className="fn-jp fn-dash-kpi-k">{kpi.k}</span>
              <span className="fn-mono fn-dash-kpi-sub">{kpi.sub}</span>
            </div>
          ))}
        </div>

        {/* Active 投稿期間s / reserved slots */}
        <section className="fn-dash-section">
          <div className="fn-section-head">
            <div className="fn-section-head-left">
              <div className="fn-section-titles">
                <span className="fn-eyebrow">active — 進行中</span>
                <h2 className="fn-display fn-section-title">進行中のイベント</h2>
              </div>
            </div>
          </div>
          <div className="fn-dash-active">
            <div className="fn-dash-active-row" onClick={() => onNav("event", { event: "pvsf2025s" })}>
              <div className="fn-dash-active-meta">
                <span className="fn-pill" data-tone="accent">投稿期間中</span>
                <span className="fn-mono fn-dash-active-code">PVSF2025S</span>
              </div>
              <div className="fn-dash-active-body">
                <span className="fn-dash-active-title fn-jp">枠 08/30 21:00 を確保済み</span>
                <div className="fn-dash-progress">
                  <div className="fn-dash-progress-bar" style={{ width: "72%" }} />
                </div>
                <span className="fn-mono fn-dash-active-hint">提出締切まで 6 日 · 動画アップロード待ち</span>
              </div>
              <button className="fn-btn" data-size="sm" data-variant="accent" onClick={(e) => { e.stopPropagation(); onNav("post"); }}>動画を提出</button>
            </div>
            <div className="fn-dash-active-row" onClick={() => onNav("event", { event: "ncnc" })}>
              <div className="fn-dash-active-meta">
                <span className="fn-pill" data-tone="muted">開幕前</span>
                <span className="fn-mono fn-dash-active-code">NCNC2025</span>
              </div>
              <div className="fn-dash-active-body">
                <span className="fn-dash-active-title fn-jp">エントリー受付待ち</span>
                <div className="fn-dash-progress">
                  <div className="fn-dash-progress-bar" style={{ width: "12%" }} />
                </div>
                <span className="fn-mono fn-dash-active-hint">募集開始まで 37 日</span>
              </div>
              <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={(e) => { e.stopPropagation(); onNav("event", { event: "ncnc" }); }}>詳細</button>
            </div>
          </div>
        </section>

        {/* My videos */}
        <section className="fn-dash-section">
          <div className="fn-section-head">
            <div className="fn-section-head-left">
              <div className="fn-section-titles">
                <span className="fn-eyebrow">library — 作品</span>
                <h2 className="fn-display fn-section-title">マイ作品</h2>
              </div>
            </div>
            <div className="fn-cr-segment">
              {[
                { id: "videos",        label: "公開中" },
                { id: "draft",         label: "下書き" },
                { id: "review",        label: "レビュー中" },
                { id: "notifications", label: "通知", badge: 2 },
              ].map(o => (
                <button key={o.id} className={"fn-cr-seg-btn " + (tab === o.id ? "is-active" : "")} onClick={() => setTab(o.id)}>
                  <span>{o.label}</span>
                  {o.badge && <span className="fn-dash-seg-badge fn-mono">{o.badge}</span>}
                </button>
              ))}
            </div>
          </div>
          {tab !== "notifications" ? (
          <table className="fn-dash-tbl">
            <thead>
              <tr><th>Title</th><th>Event</th><th>Status</th><th>Plays</th><th>Likes</th><th>Posted</th><th></th></tr>
            </thead>
            <tbody>
              {myVideos.map((v, i) => (
                <tr key={v.id} onClick={() => onNav("video", { video: v.id })}>
                  <td>
                    <div className="fn-dash-tbl-title">
                      <span className="fn-dash-tbl-thumb"><Thumb video={v} /></span>
                      <span>{v.title}</span>
                    </div>
                  </td>
                  <td className="fn-mono">{v.event}</td>
                  <td>
                    <span className="fn-pill" data-tone={i === 0 ? "warn" : "ok"}>{i === 0 ? "レビュー中" : "公開中"}</span>
                  </td>
                  <td className="fn-mono">{(v.score * 1.4 | 0).toLocaleString()}</td>
                  <td className="fn-mono">{(v.score / 50 | 0)}</td>
                  <td className="fn-mono">{v.posted}</td>
                  <td className="fn-dash-tbl-ops" onClick={e => e.stopPropagation()}>
                    <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("videoEdit", { video: v.id })}>
                      <i className="fa-solid fa-pen"></i> 編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          ) : (
          <ul className="fn-notif-list">
            {NOTIFICATIONS.map((n, i) => (
              <li key={i} className={"fn-notif-row " + (i < 2 ? "is-unread" : "")}>
                <span className={"fn-notif-icon fa-solid " + n.icon} data-tone={n.tone} aria-hidden="true"></span>
                <div className="fn-notif-body">
                  <span className="fn-jp fn-notif-text">{n.text}</span>
                  {n.sub && <span className="fn-mono fn-notif-sub">{n.sub}</span>}
                </div>
                <span className="fn-mono fn-notif-time">{n.time}</span>
              </li>
            ))}
          </ul>
          )}
        </section>
      </div>
    </main>
  );
}

// ─── ADMIN ──────────────────────────────────────────────────────
function AdminPage({ onNav, lang }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const [queue, setQueue] = _dUseState(
    videos.slice(0, 5).map((v, i) => ({ ...v, review: i === 0 ? "pending" : i === 1 ? "pending" : "approved" }))
  );
  const [active, setActive] = _dUseState(0);
  const [tab, setTab] = _dUseState("review");

  const setReview = (idx, review) => {
    setQueue(q => q.map((item, i) => i === idx ? { ...item, review } : item));
  };

  const pendingCount = queue.filter(q => q.review === "pending").length;

  const TABS = [
    { id: "review",  label: "レビュー",    badge: pendingCount },
    { id: "xid",     label: "X ID承認",    badge: 2 },
    { id: "slots",   label: "枠管理",      badge: null },
    { id: "members", label: "メンバー",    badge: null },
    { id: "history", label: "履歴",        badge: null },
    { id: "settings",label: "設定",        badge: null },
  ];

  return (
    <main className="fn-main" data-screen-label="Admin">
      <div className="fn-wrap fn-admin">
        <header className="fn-admin-head">
          <div>
            <span className="fn-eyebrow">admin console — PVSF2025S</span>
            <h1 className="fn-display fn-admin-title">運営コンソール</h1>
            <span className="fn-jp fn-admin-sub">提出レビュー・枠管理・メンバー権限。representative / editor のみ。</span>
          </div>
          <div className="fn-admin-head-actions">
            <button className="fn-btn" data-variant="accent" onClick={() => onNav("manageEvent", { event: "pvsf2025s" })}>
              <i className="fa-solid fa-arrow-up-right-from-square"></i> イベント運営ページ
            </button>
          </div>
          <div className="fn-admin-head-actions">
            {pendingCount > 0 && <span className="fn-pill" data-tone="warn">{pendingCount} 件レビュー待ち</span>}
            <button className="fn-btn" data-variant="ghost" onClick={() => onNav("dashboard")}>マイページ</button>
          </div>
        </header>

        {/* Admin nav tabs */}
        <nav className="fn-admin-tabs">
          {TABS.map(t => (
            <button key={t.id} className={"fn-admin-tab " + (tab === t.id ? "is-active" : "")} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>
              {t.badge > 0 && <span className="fn-admin-tab-badge fn-mono">{t.badge}</span>}
            </button>
          ))}
        </nav>

        {tab === "review"  && (
          <div className="fn-admin-grid">
            <div className="fn-admin-queue">
              <div className="fn-admin-queue-head">
                <span className="fn-eyebrow">queue — 提出キュー</span>
                <span className="fn-mono fn-admin-queue-count">{queue.length}</span>
              </div>
              <ol className="fn-admin-queue-list">
                {queue.map((v, i) => {
                  const c = creators.find(c => c.id === v.creator);
                  return (
                    <li key={v.id} className={"fn-admin-queue-item " + (active === i ? "is-active" : "")} onClick={() => setActive(i)}>
                      <span className={"fn-admin-queue-dot fn-review-" + v.review} aria-hidden="true" />
                      <div className="fn-admin-queue-info">
                        <span className="fn-admin-queue-title">{v.title}</span>
                        <span className="fn-mono fn-admin-queue-meta">{v.code} · {c.name}</span>
                      </div>
                      <span className={"fn-admin-queue-status fn-review-" + v.review}>
                        {v.review === "pending" ? "待機" : v.review === "approved" ? "承認" : "却下"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="fn-admin-detail">
              <ReviewDetail item={queue[active]} idx={active} setReview={setReview} creators={creators} />
            </div>
          </div>
        )}

        {tab === "slots"   && <AdminSlots />}
        {tab === "xid"     && <AdminXID />}
        {tab === "members" && <AdminMembers creators={creators} />}
        {tab === "history" && <AdminHistory creators={creators} />}
        {tab === "settings"&& <AdminSettings />}
      </div>
    </main>
  );
}

function ReviewDetail({ item, idx, setReview, creators }) {
  const c = creators.find(c => c.id === item.creator);
  let h = 0; for (let i = 0; i < item.id.length; i++) h = (h * 31 + item.id.charCodeAt(i)) % 360;
  return (
    <div className="fn-review">
      <div className="fn-review-player">
        <div className="fn-review-player-bg" style={{ background: `linear-gradient(135deg, hsl(${h} 55% 22%), hsl(${(h+50)%360} 50% 12%))` }} />
        <div className="fn-thumb-grid" aria-hidden="true" />
        <span className="fn-mono fn-review-code">{item.code}</span>
        <div className="fn-player-center-play" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 28 28"><path d="M6 4 L24 14 L6 24 Z" fill="currentColor"/></svg>
        </div>
      </div>

      <div className="fn-review-meta">
        <h2 className="fn-display fn-review-title">{item.title}</h2>
        <div className="fn-review-rows fn-mono">
          <div><span className="fn-review-k">creator</span><span>{c.name} · @{c.handle}</span></div>
          <div><span className="fn-review-k">music</span><span>{item.music}</span></div>
          <div><span className="fn-review-k">duration</span><span>{item.duration}</span></div>
          <div><span className="fn-review-k">submitted</span><span>{item.posted}</span></div>
          <div><span className="fn-review-k">slot</span><span>08/30 21:00</span></div>
        </div>

        {/* Automated checks */}
        <div className="fn-review-checks">
          <span className="fn-eyebrow">automated checks</span>
          <div className="fn-review-check is-ok"><span>✓</span><span className="fn-jp">埋め込み許可あり</span></div>
          <div className="fn-review-check is-ok"><span>✓</span><span className="fn-jp">尺レギュレーション内（〜5:00）</span></div>
          <div className="fn-review-check is-warn"><span>!</span><span className="fn-jp">楽曲クレジット要確認</span></div>
        </div>

        {/* Decision */}
        <div className="fn-review-decision">
          <span className={"fn-pill fn-review-current fn-review-" + item.review}>
            現在: {item.review === "pending" ? "レビュー待ち" : item.review === "approved" ? "承認済み" : "却下"}
          </span>
          <div className="fn-review-buttons">
            <button className="fn-btn fn-review-reject" data-size="lg" onClick={() => setReview(idx, "rejected")}>却下</button>
            <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => setReview(idx, "approved")}>承認して公開 →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── X ID承認 ───────────────────────────────────────────────────
function AdminXID() {
  const XID_QUEUE = [
    { handle: "new_creator_01", name: "新規ユーザー A", discord: "newuser#1234", submitted: "07/23", status: "pending" },
    { handle: "mayu_films", name: "mayu", discord: "mayu#5678", submitted: "07/22", status: "pending" },
    { handle: "another_mv", name: "another", discord: "another#9012", submitted: "07/20", status: "approved" },
    { handle: "drifted_01", name: "drifted", discord: "drifted#3456", submitted: "07/18", status: "rejected" },
    { handle: "silversound_", name: "silver sound", discord: "silv#7890", submitted: "07/15", status: "approved" },
  ];
  const [items, setItems] = _dUseState(XID_QUEUE);
  const decide = (i, status) => setItems(q => q.map((x, j) => j === i ? { ...x, status } : x));
  const stateMeta = {
    pending:  { label: "審査待ち", tone: "warn" },
    approved: { label: "承認済み", tone: "ok" },
    rejected: { label: "却下",     tone: "muted" },
  };
  return (
    <div className="fn-admin-xid">
      <div className="fn-admin-xid-head">
        <span className="fn-eyebrow">x id 承認キュー — 申請フォーム経由（API不使用）</span>
        <span className="fn-admin-xid-note fn-jp">ハンドル存在確認→手動承認。承認後、クレジット・スロット表示に反映。</span>
      </div>
      <table className="fn-admin-xid-tbl">
        <thead>
          <tr><th>X ハンドル</th><th>氏名・活動名</th><th>Discord</th><th>申請日</th><th>状態</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((x, i) => {
            const m = stateMeta[x.status];
            return (
              <tr key={i} className={"fn-admin-xid-row fn-xidrow-" + x.status}>
                <td className="fn-mono">
                  <span className="fn-admin-xid-handle">
                    <i className="fa-brands fa-x-twitter"></i> @{x.handle}
                  </span>
                </td>
                <td>{x.name}</td>
                <td className="fn-mono fn-admin-xid-discord">
                  <i className="fa-brands fa-discord" style={{ color: "#5865F2" }}></i> {x.discord}
                </td>
                <td className="fn-mono">{x.submitted}</td>
                <td><span className="fn-pill" data-tone={m.tone}>{m.label}</span></td>
                <td className="fn-admin-xid-ops">
                  {x.status === "pending" && <>
                    <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => decide(i, "rejected")}>却下</button>
                    <button className="fn-btn" data-size="sm" data-variant="accent" onClick={() => decide(i, "approved")}>承認</button>
                  </>}
                  {x.status === "approved" && <span className="fn-mono fn-admin-xid-done">✓ 承認済み</span>}
                  {x.status === "rejected" && <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => decide(i, "approved")}>取り消し</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="fn-admin-xid-guide">
        <span className="fn-eyebrow">承認フロー</span>
        <ol className="fn-admin-xid-steps fn-jp">
          <li>申請者が X ハンドルを入力（OAuth不使用）</li>
          <li>運営がそのハンドルの X アカウントを目視確認</li>
          <li>このページで承認 → クレジット・スロット表示に反映</li>
          <li>却下の場合、24時間以内に本人が元枠を優先再取得可能</li>
        </ol>
      </div>
    </div>
  );
}

function AdminSlots() {
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;
  let reserved = 0, submitted = 0, avail = 0, reclaim = 0, total = 0;
  matrix.forEach(r => r.forEach(c => { total++; if (c.status === "reserved") reserved++; else if (c.status === "submitted") submitted++; else if (c.status === "available") avail++; else reclaim++; }));
  const [filter, setFilter] = _dUseState("all");
  const rows = [];
  days.forEach((d, di) => hours.forEach((h, hi) => {
    const c = matrix[di][hi];
    if (filter !== "all" && c.status !== filter) return;
    rows.push({ day: d, hour: h, ...c });
  }));
  return (
    <div className="fn-admin-panel">
      <div className="fn-admin-kpis">
        {[
          { k: "総枠数", en: "total", v: total },
          { k: "提出済み", en: "submitted", v: submitted, tone: "accent" },
          { k: "確保済み", en: "reserved", v: reserved },
          { k: "空き", en: "available", v: avail, tone: "ok" },
          { k: "再取得中", en: "reclaim", v: reclaim, tone: "warn" },
        ].map((s, i) => (
          <div key={i} className="fn-admin-kpi" data-tone={s.tone || ""}>
            <span className="fn-eyebrow">{s.en}</span>
            <span className="fn-display fn-admin-kpi-v">{String(s.v).padStart(2, "0")}</span>
            <span className="fn-jp fn-admin-kpi-k">{s.k}</span>
          </div>
        ))}
      </div>
      <div className="fn-admin-toolbar">
        <div className="fn-cr-segment">
          {[["all","すべて"],["submitted","提出済み"],["reserved","確保済み"],["available","空き"],["reclaim","再取得中"]].map(([id,l]) => (
            <button key={id} className={"fn-cr-seg-btn " + (filter === id ? "is-active" : "")} onClick={() => setFilter(id)}><span>{l}</span></button>
          ))}
        </div>
        <button className="fn-btn" data-size="sm" data-variant="ghost">CSV書き出し</button>
      </div>
      <table className="fn-admin-tbl">
        <thead>
          <tr><th>枠</th><th>日</th><th>名義</th><th>状態</th><th>操作</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="fn-mono">{r.hour}</td>
              <td className="fn-mono">{r.day}</td>
              <td>{r.name ?? <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
              <td><span className={"fn-pill fn-slot-pill-" + r.status} data-tone={r.status === "submitted" ? "accent" : r.status === "available" ? "ok" : r.status === "reclaim" ? "warn" : "muted"}>{slotStatusJa(r.status)}</span></td>
              <td className="fn-admin-tbl-ops">
                {r.status === "available"
                  ? <button className="fn-link">確保</button>
                  : <><button className="fn-link">詳細</button><button className="fn-link fn-link-danger">解放</button></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function slotStatusJa(s) { return { reserved: "確保済み", submitted: "提出済み", available: "空き", reclaim: "再取得中" }[s] || s; }

function AdminMembers({ creators }) {
  const [members, setMembers] = _dUseState([
    { id: "halo_loop", name: "halo / loop", handle: "halo_loop_v", role: "representative", scopes: { event: true, slots: true, videos: true, members: true } },
    { id: "frame_index", name: "frame index", handle: "frame_index__", role: "editor", scopes: { event: false, slots: true, videos: true, members: false } },
    { id: "rin_otsuka", name: "凜・大塚", handle: "rin_otsuka_", role: "editor", scopes: { event: true, slots: false, videos: true, members: false } },
    { id: "kotorinosu", name: "ことりのす", handle: "kotorinosu_mv", role: "collaborator", scopes: { event: false, slots: false, videos: true, members: false } },
  ]);
  const SCOPES = [["event","イベント"],["slots","枠"],["videos","作品"],["members","メンバー"]];
  const roleLabel = { representative: "代表", editor: "編集者", collaborator: "協力者" };
  const toggle = (id, key) => setMembers(m => m.map(x => x.id === id ? { ...x, scopes: { ...x.scopes, [key]: !x.scopes[key] } } : x));
  return (
    <div className="fn-admin-panel">
      <div className="fn-admin-toolbar">
        <span className="fn-eyebrow">crew — 運営メンバー {members.length}名</span>
        <button className="fn-btn" data-size="sm" data-variant="accent">＋ メンバーを招待</button>
      </div>
      <table className="fn-admin-tbl fn-admin-members">
        <thead>
          <tr><th>メンバー</th><th>権限</th>{SCOPES.map(([k,l]) => <th key={k} className="fn-admin-scope-th">{l}</th>)}<th></th></tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td>
                <div className="fn-cred-name"><span className="fn-cred-avatar">{m.name.charAt(0)}</span><div><div style={{ fontWeight: 600 }}>{m.name}</div><span className="fn-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}><i className="fa-brands fa-x-twitter"></i> @{m.handle}</span></div></div>
              </td>
              <td><span className="fn-pill" data-tone={m.role === "representative" ? "accent" : "muted"}>{roleLabel[m.role]}</span></td>
              {SCOPES.map(([k]) => (
                <td key={k} className="fn-admin-scope-td">
                  <button className={"fn-toggle " + (m.scopes[k] ? "is-on" : "")} disabled={m.role === "representative"} onClick={() => toggle(m.id, k)} aria-label={k}>
                    <span className="fn-toggle-knob" />
                  </button>
                </td>
              ))}
              <td>{m.role !== "representative" && <button className="fn-link fn-link-danger">除名</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminHistory({ creators }) {
  const LOG = [
    { t: "19:42", d: "07/25", who: "halo_loop_v", act: "approved", target: "結節線 (PVSF2025S-021)", kind: "review" },
    { t: "18:30", d: "07/25", who: "frame_index__", act: "rejected", target: "Pale Index (PVSF2025S-009)", kind: "review" },
    { t: "16:05", d: "07/25", who: "rin_otsuka_", act: "released", target: "slot 08/31 22:30", kind: "slot" },
    { t: "14:48", d: "07/24", who: "halo_loop_v", act: "invited", target: "ことりのす (@kotorinosu_mv)", kind: "member" },
    { t: "11:20", d: "07/24", who: "system", act: "auto-released", target: "slot 08/29 19:30 · 未提出", kind: "slot" },
    { t: "09:12", d: "07/24", who: "frame_index__", act: "edited", target: "イベント設問を更新", kind: "settings" },
    { t: "22:01", d: "07/23", who: "rin_otsuka_", act: "approved", target: "ちいさな観測 (NCNC2025-007)", kind: "review" },
  ];
  const actJa = { approved: "承認", rejected: "却下", released: "枠解放", invited: "招待", "auto-released": "自動解放", edited: "編集" };
  const [filter, setFilter] = _dUseState("all");
  const shown = LOG.filter(l => filter === "all" || l.kind === filter);
  return (
    <div className="fn-admin-panel">
      <div className="fn-admin-toolbar">
        <div className="fn-cr-segment">
          {[["all","すべて"],["review","レビュー"],["slot","枠"],["member","メンバー"],["settings","設定"]].map(([id,l]) => (
            <button key={id} className={"fn-cr-seg-btn " + (filter === id ? "is-active" : "")} onClick={() => setFilter(id)}><span>{l}</span></button>
          ))}
        </div>
        <span className="fn-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>監査ログ · 直近 7 件</span>
      </div>
      <ol className="fn-admin-log">
        {shown.map((l, i) => (
          <li key={i} className="fn-admin-log-row">
            <span className="fn-mono fn-admin-log-time">{l.d} {l.t}</span>
            <span className={"fn-admin-log-act fn-log-" + l.kind}>{actJa[l.act] || l.act}</span>
            <span className="fn-admin-log-target">{l.target}</span>
            <span className="fn-mono fn-admin-log-who">@{l.who}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AdminSettings() {
  return (
    <div className="fn-admin-panel">
      <div className="fn-admin-settings-grid">
        <section className="fn-fsec">
          <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">01</span><div><h2 className="fn-fsec-title">会期・締切</h2><span className="fn-fsec-en fn-mono">Schedule</span></div></div></div>
          <div className="fn-fsec-body">
            <div className="fn-field-grid">
              <label className="fn-field"><span className="fn-field-label">募集開始</span><input className="fn-input fn-mono" defaultValue="2025-07-12" /></label>
              <label className="fn-field"><span className="fn-field-label">募集締切</span><input className="fn-input fn-mono" defaultValue="2025-08-15" /></label>
              <label className="fn-field"><span className="fn-field-label">投稿開始</span><input className="fn-input fn-mono" defaultValue="2025-08-29" /></label>
              <label className="fn-field"><span className="fn-field-label">投稿締切</span><input className="fn-input fn-mono" defaultValue="2025-08-31" /></label>
            </div>
          </div>
        </section>
        <section className="fn-fsec">
          <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">02</span><div><h2 className="fn-fsec-title">枠・規定</h2><span className="fn-fsec-en fn-mono">Rules</span></div></div></div>
          <div className="fn-fsec-body">
            <div className="fn-field-grid">
              <label className="fn-field"><span className="fn-field-label">総枠数</span><input className="fn-input fn-mono" defaultValue="96" /></label>
              <label className="fn-field"><span className="fn-field-label">最大尺 (分)</span><input className="fn-input fn-mono" defaultValue="5:00" /></label>
              <label className="fn-field fn-field-wide"><span className="fn-field-label">未提出枠の自動解放</span>
                <select className="fn-input" defaultValue="on"><option value="on">締切24時間前に自動解放</option><option value="off">手動のみ</option></select>
              </label>
            </div>
            <label className="fn-checkbox" style={{ marginTop: 12 }}><input type="checkbox" defaultChecked /><span className="fn-jp">優先再取得（却下後24時間）を有効化</span></label>
          </div>
        </section>
      </div>
      <div className="fn-admin-settings-foot">
        <span className="fn-sb-autosave fn-mono">最終保存 07/25 19:42 · @halo_loop_v</span>
        <button className="fn-btn" data-variant="accent" data-size="lg">設定を保存</button>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, AdminPage });
