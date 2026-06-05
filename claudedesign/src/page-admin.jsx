// Admin console — full sidebar layout
// Routes: overview / review / x-id / x-id-merges / audit / cost-guard / users / youtube-sync / health / settings

const { useState: _adUs, useReducer: _adUr } = React;

// ─── Sidebar nav definition ────────────────────────────────────
const ADMIN_NAV = [
  {
    group: "概要",
    items: [
      { id: "overview",   icon: "fa-gauge",         label: "ダッシュボード" },
    ],
  },
  {
    group: "対応待ち",
    items: [
      { id: "review",     icon: "fa-film",           label: "動画レビュー",   badge: 2 },
      { id: "xid",        icon: "fa-id-badge",       label: "X ID 申請",     badge: 3 },
      { id: "xidmerges",  icon: "fa-code-merge",     label: "X ID 統合",     badge: 1 },
    ],
  },
  {
    group: "コンテンツ",
    items: [
      { id: "moderation", icon: "fa-shield-halved",  label: "モデレーション" },
      { id: "events",     icon: "fa-calendar",       label: "イベント管理" },
    ],
  },
  {
    group: "ユーザー",
    items: [
      { id: "users",      icon: "fa-users",          label: "ユーザー一覧" },
      { id: "audit",      icon: "fa-scroll",         label: "監査ログ" },
    ],
  },
  {
    group: "システム",
    items: [
      { id: "costguard",  icon: "fa-gauge-high",     label: "コストガード" },
      { id: "ytsync",     icon: "fa-rotate",         label: "YouTube 同期" },
      { id: "health",     icon: "fa-heart-pulse",    label: "ヘルス" },
      { id: "security",   icon: "fa-lock",           label: "セキュリティ" },
      { id: "adminsettings", icon: "fa-sliders",     label: "設定" },
    ],
  },
];

function AdminPage({ onNav }) {
  const [sub, setSub] = _adUs("overview");
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS;
  const totalBadges = ADMIN_NAV.flatMap(g => g.items).reduce((n, i) => n + (i.badge || 0), 0);

  const subPages = {
    overview:    <AdminOverview onNav={onNav} setSub={setSub} />,
    review:      <AdminReview videos={videos} creators={creators} onNav={onNav} />,
    xid:         <AdminXID />,
    xidmerges:   <AdminXIdMerges />,
    moderation:  <AdminModeration videos={videos} creators={creators} onNav={onNav} />,
    events:      <AdminEvents onNav={onNav} />,
    users:       <AdminUsers onNav={onNav} creators={creators} setSub={setSub} />,
    audit:       <AdminAudit />,
    costguard:   <AdminCostGuard />,
    ytsync:      <AdminYTSync videos={videos} />,
    health:      <AdminHealth />,
    security:    <AdminSecurity />,
    adminsettings: <AdminSettings />,
  };

  return (
    <main className="fn-main fn-admin-shell" data-screen-label="Admin">
      <div className="fn-admin-layout">
        {/* Sidebar */}
        <aside className="fn-admin-sidebar">
          <div className="fn-admin-sidebar-head">
            <span className="fn-display fn-admin-sidebar-title">管理コンソール</span>
            {totalBadges > 0 && <span className="fn-admin-global-badge fn-mono">{totalBadges}</span>}
          </div>
          <nav>
            {ADMIN_NAV.map(g => (
              <div key={g.group} className="fn-admin-nav-group">
                <span className="fn-admin-nav-group-label fn-mono">{g.group}</span>
                {g.items.map(item => (
                  <button
                    key={item.id}
                    className={"fn-admin-nav-item " + (sub === item.id ? "is-active" : "")}
                    onClick={() => setSub(item.id)}
                  >
                    <i className={"fa-solid " + item.icon + " fn-admin-nav-icon"}></i>
                    <span>{item.label}</span>
                    {item.badge > 0 && <span className="fn-admin-tab-badge fn-mono" style={{ marginLeft: "auto" }}>{item.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="fn-admin-sidebar-foot">
            <button className="fn-admin-nav-item" onClick={() => onNav("dashboard")}>
              <i className="fa-solid fa-arrow-left fn-admin-nav-icon"></i>
              <span>マイページへ</span>
            </button>
            <div className="fn-admin-sys-status">
              <span className="fn-admin-sys-dot" data-ok="1"></span>
              <span className="fn-mono">KV.GUARD=NORMAL</span>
            </div>
          </div>
        </aside>

        {/* Content area */}
        <div className="fn-admin-content">
          {subPages[sub] || <AdminOverview onNav={onNav} setSub={setSub} />}
        </div>
      </div>
    </main>
  );
}

// ─── Overview ────────────────────────────────────────────────────
function AdminOverview({ onNav, setSub }) {
  const stats = [
    { k: "総ユーザー", v: "412", icon: "fa-users",     trend: "+3 今週" },
    { k: "公開動画",   v: "1,284", icon: "fa-film",    trend: "+12 今週" },
    { k: "今月 D1",    v: "0.18$", icon: "fa-database", trend: "上限 5$ まで余裕" },
    { k: "KV 読取",   v: "92,400", icon: "fa-bolt",    trend: "今日" },
  ];
  const alerts = [
    { tone: "warn", icon: "fa-id-badge", text: "X ID 申請 3 件が承認待ちです", action: () => setSub("xid") },
    { tone: "warn", icon: "fa-film", text: "動画レビュー 2 件が対応待ちです", action: () => setSub("review") },
    { tone: "ok",   icon: "fa-heart-pulse", text: "すべてのシステムサービスは正常です", action: () => setSub("health") },
  ];
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">ダッシュボード</h2>
      </div>
      <div className="fn-admin-ov-stats">
        {stats.map((s, i) => (
          <div key={i} className="fn-admin-ov-stat">
            <i className={"fa-solid " + s.icon + " fn-admin-ov-stat-icon"}></i>
            <div>
              <span className="fn-eyebrow">{s.k}</span>
              <span className="fn-display fn-admin-ov-stat-v">{s.v}</span>
              <span className="fn-mono fn-admin-ov-stat-trend">{s.trend}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="fn-admin-alerts">
        {alerts.map((a, i) => (
          <button key={i} className={"fn-admin-alert fn-admin-alert--" + a.tone} onClick={a.action}>
            <i className={"fa-solid " + a.icon}></i>
            <span className="fn-jp">{a.text}</span>
            <span className="fn-admin-alert-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Review ──────────────────────────────────────────────────────
function AdminReview({ videos, creators, onNav }) {
  const queue = videos.slice(0, 5).map((v, i) => ({
    ...v, status: i === 0 ? "pending" : i === 1 ? "flagged" : "pending",
  }));
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">動画レビュー</h2>
      </div>
      <table className="fn-admin-xid-tbl">
        <thead><tr><th>動画</th><th>クリエイター</th><th>イベント</th><th>状態</th><th></th></tr></thead>
        <tbody>
          {queue.map((v, i) => {
            const c = creators.find(cr => cr.id === v.creator);
            return (
              <tr key={v.id} className="fn-admin-xid-row">
                <td><div style={{ display:"flex", gap: 10, alignItems:"center" }}>
                  <div style={{ width:60,flexShrink:0 }}><Thumb video={v} /></div>
                  <div><div style={{ fontWeight:600, fontSize:13 }}>{v.title}</div><div className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{v.code}</div></div>
                </div></td>
                <td>{c?.name}</td>
                <td className="fn-mono">{v.event.toUpperCase()}</td>
                <td><span className="fn-pill" data-tone={v.status === "flagged" ? "warn" : "muted"}>{v.status === "flagged" ? "要確認" : "審査待ち"}</span></td>
                <td className="fn-admin-xid-ops">
                  <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("video", { video: v.id })}>確認</button>
                  <button className="fn-btn" data-size="sm" data-variant="accent">承認</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Moderation ──────────────────────────────────────────────────
function AdminModeration({ videos, creators, onNav }) {
  const REPORTS = [
    { vid: videos[0], reporter: "unknown_user", reason: "不適切なコンテンツ", time: "07/25 18:30" },
    { vid: videos[3], reporter: "anon_03",      reason: "著作権の懸念",       time: "07/24 12:00" },
  ];
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">モデレーション</h2>
      </div>
      {REPORTS.length === 0 ? (
        <p className="fn-jp" style={{ color:"var(--text-muted)", padding:"24px 0" }}>報告はありません。</p>
      ) : (
        <table className="fn-admin-xid-tbl">
          <thead><tr><th>動画</th><th>報告者</th><th>理由</th><th>報告日時</th><th></th></tr></thead>
          <tbody>
            {REPORTS.map((r, i) => {
              const c = creators.find(cr => cr.id === r.vid.creator);
              return (
                <tr key={i} className="fn-admin-xid-row">
                  <td><div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ width:56,flexShrink:0 }}><Thumb video={r.vid} /></div>
                    <div><div style={{ fontWeight:600,fontSize:13 }}>{r.vid.title}</div><div className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{c?.name}</div></div>
                  </div></td>
                  <td className="fn-mono">{r.reporter}</td>
                  <td className="fn-jp">{r.reason}</td>
                  <td className="fn-mono">{r.time}</td>
                  <td className="fn-admin-xid-ops">
                    <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("video", { video: r.vid.id })}>確認</button>
                    <button className="fn-btn" data-size="sm" data-variant="accent">却下</button>
                    <button className="fn-btn" data-size="sm" style={{ color:"var(--danger,#ff5a5f)" }}>非公開</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Events admin ─────────────────────────────────────────────────
function AdminEvents({ onNav }) {
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">イベント管理</h2>
        <button className="fn-btn" data-variant="accent" data-size="sm">新規作成 +</button>
      </div>
      <table className="fn-admin-xid-tbl">
        <thead><tr><th>コード</th><th>タイトル</th><th>状態</th><th>作品数</th><th>クリエイター</th><th></th></tr></thead>
        <tbody>
          {window.FN_EVENTS.map(ev => {
            const s = window.deriveStatus(ev, "auto");
            const label = window.statusLabel(s.kind, "ja");
            return (
              <tr key={ev.id} className="fn-admin-xid-row">
                <td className="fn-mono">{ev.code}</td>
                <td>{ev.title}</td>
                <td><span className="fn-pill" data-tone={s.kind === "entry" || s.kind === "submit" ? "accent" : "muted"}>{label}</span></td>
                <td className="fn-mono">{ev.entries}</td>
                <td className="fn-mono">{ev.creators}</td>
                <td className="fn-admin-xid-ops">
                  <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("manageEvent", { event: ev.id })}>管理</button>
                  <button className="fn-btn" data-size="sm" data-variant="ghost">編集</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Users ────────────────────────────────────────────────────────
function AdminUsers({ onNav, creators, setSub }) {
  const [search, setSearch] = _adUs("");
  const filtered = creators.filter(c =>
    !search || c.name.includes(search) || c.handle.includes(search)
  );
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">ユーザー一覧</h2>
        <input className="fn-cr-input fn-mono" placeholder="名前/ハンドルで検索" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
      </div>
      <table className="fn-admin-xid-tbl">
        <thead><tr><th>名前</th><th>X ハンドル</th><th>作品数</th><th>ロール</th><th></th></tr></thead>
        <tbody>
          {filtered.map((c, i) => (
            <tr key={c.id} className="fn-admin-xid-row">
              <td><div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div className="fn-vcard-avatar">{c.name.charAt(0)}</div>
                {c.name}
              </div></td>
              <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{c.handle}</td>
              <td className="fn-mono">{c.videos}</td>
              <td><span className="fn-pill" data-tone={i < 3 ? "accent" : "muted"}>{i < 3 ? "editor" : "creator"}</span></td>
              <td><button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("adminUserDetail", { adminUserId: c.id })}>詳細</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Audit log ───────────────────────────────────────────────────
const AUDIT_ROWS = [
  { table: "videos",     action: "UPDATE", operator: "halo_loop_v",   record: "fn-003", diff: ["title","visibility_status"], time: "07/25 20:11", actorType: "admin" },
  { table: "users",      action: "UPDATE", operator: "halo_loop_v",   record: "user-07", diff: ["role"],                    time: "07/25 18:30", actorType: "admin" },
  { table: "xUsers",     action: "CREATE", operator: "halo_loop_v",   record: "xu-22",  diff: [],                           time: "07/25 14:00", actorType: "admin" },
  { table: "events",     action: "UPDATE", operator: "frame_index__", record: "pvsf2025s", diff: ["slot_capacity"],         time: "07/24 22:41", actorType: "manage" },
  { table: "videos",     action: "DELETE", operator: "halo_loop_v",   record: "fn-001", diff: [],                           time: "07/24 20:00", actorType: "admin" },
  { table: "systemSettings", action: "UPDATE", operator: "halo_loop_v", record: "sys-1", diff: ["cost_guard_mode"],         time: "07/23 09:00", actorType: "admin" },
  { table: "xAccountLinkRequests", action: "UPDATE", operator: "halo_loop_v", record: "req-04", diff: ["status"],           time: "07/22 17:20", actorType: "admin" },
  { table: "videos",     action: "CREATE", operator: "frame_index__", record: "fn-012", diff: [],                           time: "07/21 12:00", actorType: "user" },
];

function AdminAudit() {
  const [tableF, setTableF] = _adUs("");
  const [actionF, setActionF] = _adUs("");
  const [view, setView] = _adUs("table");
  const tables = [...new Set(AUDIT_ROWS.map(r => r.table))];
  const filtered = AUDIT_ROWS.filter(r =>
    (!tableF || r.table === tableF) &&
    (!actionF || r.action === actionF)
  );
  const actionColor = a => a === "CREATE" ? "var(--ok)" : a === "UPDATE" ? "var(--accent-strong)" : "var(--danger,#ff5a5f)";
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">監査ログ</h2>
        <div className="fn-row" style={{ gap: 8 }}>
          <div className="fn-cr-segment">
            {["table","timeline"].map(v => <button key={v} className={"fn-cr-seg-btn " + (view === v ? "is-active" : "")} onClick={() => setView(v)}><span className="fn-mono">{v}</span></button>)}
          </div>
        </div>
      </div>
      <div className="fn-admin-audit-filters">
        <select className="fn-input fn-mono" style={{ height:34,padding:"0 10px",fontSize:12 }} value={tableF} onChange={e => setTableF(e.target.value)}>
          <option value="">全テーブル</option>
          {tables.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fn-input fn-mono" style={{ height:34,padding:"0 10px",fontSize:12 }} value={actionF} onChange={e => setActionF(e.target.value)}>
          <option value="">全アクション</option>
          {["CREATE","UPDATE","DELETE"].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="fn-mono" style={{ fontSize:12,color:"var(--text-muted)" }}>{filtered.length} 件</span>
      </div>

      {view === "table" ? (
        <table className="fn-admin-xid-tbl">
          <thead><tr><th>時刻</th><th>テーブル</th><th>アクション</th><th>レコードID</th><th>操作者</th><th>差分フィールド</th><th>主体</th></tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className="fn-admin-xid-row">
                <td className="fn-mono" style={{ fontSize:11,whiteSpace:"nowrap" }}>{r.time}</td>
                <td className="fn-mono">{r.table}</td>
                <td><span className="fn-mono" style={{ fontSize:11,color:actionColor(r.action),fontWeight:700 }}>{r.action}</span></td>
                <td className="fn-mono" style={{ fontSize:11 }}>{r.record}</td>
                <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{r.operator}</td>
                <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{r.diff.length > 0 ? r.diff.join(", ") : "—"}</td>
                <td><span className="fn-pill" data-tone={r.actorType === "admin" ? "accent" : "muted"}>{r.actorType}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ol className="fn-audit-timeline">
          {filtered.map((r, i) => (
            <li key={i} className="fn-audit-tl-row">
              <span className="fn-mono fn-audit-tl-time">{r.time.split(" ")[1]}</span>
              <span className="fn-audit-tl-dot" style={{ background: actionColor(r.action) }}></span>
              <div className="fn-audit-tl-body">
                <span className="fn-mono fn-audit-tl-action" style={{ color: actionColor(r.action) }}>{r.action}</span>
                <span className="fn-audit-tl-table fn-mono"> {r.table}</span>
                <span className="fn-audit-tl-record fn-mono"> #{r.record}</span>
                {r.diff.length > 0 && <span className="fn-audit-tl-diff fn-mono"> [{r.diff.join(", ")}]</span>}
                <div className="fn-mono fn-audit-tl-op" style={{ fontSize:11,color:"var(--text-muted)" }}>by @{r.operator} · {r.actorType}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Cost Guard ───────────────────────────────────────────────────
const CG_MODES = [
  { id: "normal",     label: "通常",       desc: "全機能フル稼働。",                             badge: "ok" },
  { id: "economy",    label: "省エネ",     desc: "重い検索・推薦の更新間隔を緩める。",             badge: "warn" },
  { id: "read_only",  label: "読み取り専用", desc: "投稿・更新・通知系を停止し、閲覧のみ許可。",  badge: "warn" },
  { id: "static_only",label: "静的のみ",   desc: "静的 JSON ベースの閲覧のみ提供する。",          badge: "danger" },
  { id: "maintenance",label: "メンテナンス", desc: "全機能停止、メンテナンス画面に誘導する。",     badge: "danger" },
];
const CG_USAGE = [
  { name: "D1 reads",    used: 18400, limit: 5000000, unit: "req/day" },
  { name: "D1 writes",   used: 2100,  limit: 100000,  unit: "req/day" },
  { name: "KV reads",    used: 92400, limit: 1000000, unit: "req/day" },
  { name: "KV writes",   used: 840,   limit: 1000,    unit: "req/day" },
  { name: "R2 class-A",  used: 210,   limit: 1000000, unit: "ops/month" },
];

function AdminCostGuard() {
  const [mode, setMode] = _adUs("normal");
  const [autoEnabled, setAuto] = _adUs(true);
  const [reason, setReason] = _adUs("");
  const [saved, setSaved] = _adUs(false);
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const recommend = mode === "normal" ? "normal" : mode;

  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">コストガード</h2>
        <span className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>自動制御: {autoEnabled ? "有効" : "無効"}</span>
      </div>

      {/* Usage meters */}
      <section className="fn-cg-section">
        <span className="fn-eyebrow" style={{ marginBottom:12,display:"block" }}>現在の使用量</span>
        <div className="fn-cg-meters">
          {CG_USAGE.map((u, i) => {
            const pct = Math.min(100, (u.used / u.limit) * 100);
            const tone = pct > 90 ? "danger" : pct > 70 ? "warn" : "ok";
            return (
              <div key={i} className="fn-cg-meter">
                <div className="fn-cg-meter-head">
                  <span className="fn-mono fn-cg-meter-name">{u.name}</span>
                  <span className="fn-mono fn-cg-meter-val">{u.used.toLocaleString()}<span style={{ color:"var(--text-faint)" }}>/{u.limit.toLocaleString()}</span> {u.unit}</span>
                </div>
                <div className="fn-cg-bar"><div className={"fn-cg-bar-fill fn-cg-bar-fill--"+tone} style={{ width: pct + "%" }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Mode selector */}
      <section className="fn-cg-section">
        <span className="fn-eyebrow" style={{ marginBottom:12,display:"block" }}>動作モード</span>
        <div className="fn-cg-modes">
          {CG_MODES.map(m => (
            <button
              key={m.id}
              className={"fn-cg-mode " + (mode === m.id ? "is-active" : "")}
              onClick={() => setMode(m.id)}
            >
              <div className="fn-cg-mode-head">
                <span className="fn-display fn-cg-mode-label">{m.label}</span>
                <span className={"fn-pill"} data-tone={mode === m.id ? m.badge : "muted"}>{m.id}</span>
              </div>
              <span className="fn-jp fn-cg-mode-desc">{m.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Reason + auto */}
      <section className="fn-cg-section fn-cg-controls">
        <label className="fn-field" style={{ flex:1 }}>
          <span className="fn-field-label">変更理由（任意）</span>
          <input className="fn-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="例: コスト急増のため読み取り専用に切替" />
        </label>
        <label className="fn-chapcomp-toggle" style={{ paddingTop:24 }}>
          <button className={"fn-switch " + (autoEnabled ? "is-on" : "")} onClick={() => setAuto(v => !v)}><span className="fn-switch-knob" /></button>
          <span className="fn-jp">自動コストガード（閾値超過時に自動切替）</span>
        </label>
      </section>

      <button className="fn-btn" data-variant="accent" data-size="lg" onClick={save} style={{ marginTop: 8 }}>
        {saved ? <><i className="fa-solid fa-check"></i> 保存しました</> : "モードを適用 →"}
      </button>

      {/* History */}
      <section className="fn-cg-section" style={{ marginTop: 28 }}>
        <span className="fn-eyebrow" style={{ marginBottom:12,display:"block" }}>変更履歴</span>
        <table className="fn-admin-xid-tbl">
          <thead><tr><th>日時</th><th>モード</th><th>理由</th><th>操作者</th></tr></thead>
          <tbody>
            {[
              { t:"07/25 09:00", m:"normal",    r:"テスト後、通常に戻す", op:"halo_loop_v" },
              { t:"07/24 22:00", m:"read_only", r:"D1 writes 急増のため", op:"halo_loop_v" },
              { t:"07/20 08:00", m:"normal",    r:"メンテ完了",          op:"halo_loop_v" },
            ].map((h, i) => (
              <tr key={i} className="fn-admin-xid-row">
                <td className="fn-mono" style={{ fontSize:11 }}>{h.t}</td>
                <td><span className="fn-mono" style={{ fontSize:12 }}>{h.m}</span></td>
                <td className="fn-jp" style={{ fontSize:12 }}>{h.r}</td>
                <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{h.op}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── X ID Merges ──────────────────────────────────────────────────
const MERGE_REQUESTS = [
  { id:"mg-01", from:"negativecue_old", to:"negativecue",   status:"pending",  videos:3, likes:12, bookmarks:4, time:"07/25 15:00" },
  { id:"mg-02", from:"halo_loop",       to:"halo_loop_v",   status:"approved", videos:8, likes:44, bookmarks:11, time:"07/20 09:00" },
];
const MERGE_REVERTS = [
  { id:"rv-01", mergeId:"mg-01b", from:"old_handle", to:"new_handle", requestedAt:"07/18 14:00", status:"pending" },
];

function AdminXIdMerges() {
  const [view, setView] = _adUs("requests");
  const [expanded, setExpanded] = _adUs(null);

  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">X ID 統合管理</h2>
        <div className="fn-cr-segment">
          <button className={"fn-cr-seg-btn " + (view==="requests"?"is-active":"")} onClick={() => setView("requests")}><span>申請 ({MERGE_REQUESTS.length})</span></button>
          <button className={"fn-cr-seg-btn " + (view==="reverts"?"is-active":"")} onClick={() => setView("reverts")}><span>差し戻し ({MERGE_REVERTS.length})</span></button>
        </div>
      </div>

      <div className="fn-xidmerge-note fn-jp">
        <i className="fa-solid fa-circle-info"></i>
        X ハンドルの変更（例: @old → @new）に伴い、過去の投稿・いいね・ブックマークを新 ID に統合します。
      </div>

      {view === "requests" ? (
        <div className="fn-xidmerge-list">
          {MERGE_REQUESTS.map(r => (
            <div key={r.id} className="fn-xidmerge-card">
              <div className="fn-xidmerge-head" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                <div className="fn-xidmerge-ids">
                  <span className="fn-mono fn-xidmerge-from"><i className="fa-brands fa-x-twitter"></i> @{r.from}</span>
                  <span className="fn-mono fn-xidmerge-arrow">→</span>
                  <span className="fn-mono fn-xidmerge-to"><i className="fa-brands fa-x-twitter"></i> @{r.to}</span>
                </div>
                <span className="fn-pill" data-tone={r.status==="pending"?"warn":r.status==="approved"?"ok":"muted"}>{r.status}</span>
                <span className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)",marginLeft:"auto" }}>{r.time}</span>
              </div>
              {expanded === r.id && (
                <div className="fn-xidmerge-impact">
                  <span className="fn-eyebrow" style={{ display:"block",marginBottom:10 }}>影響範囲プレビュー</span>
                  <div className="fn-xidmerge-impact-grid">
                    <div><span className="fn-eyebrow">動画</span><span className="fn-display fn-xidmerge-impact-v">{r.videos}</span></div>
                    <div><span className="fn-eyebrow">いいね</span><span className="fn-display fn-xidmerge-impact-v">{r.likes}</span></div>
                    <div><span className="fn-eyebrow">ブックマーク</span><span className="fn-display fn-xidmerge-impact-v">{r.bookmarks}</span></div>
                  </div>
                  {r.status === "pending" && (
                    <div className="fn-admin-xid-ops" style={{ marginTop:14 }}>
                      <button className="fn-btn" data-size="sm" data-variant="ghost">却下</button>
                      <button className="fn-btn" data-size="sm">承認（確認済み）</button>
                      <button className="fn-btn" data-size="sm" data-variant="accent">承認 → 実行</button>
                    </div>
                  )}
                  {r.status === "approved" && (
                    <div className="fn-admin-xid-ops" style={{ marginTop:14 }}>
                      <span className="fn-mono" style={{ fontSize:11,color:"var(--ok)" }}><i className="fa-solid fa-check"></i> 承認済み · 実行待ち</span>
                      <button className="fn-btn" data-size="sm" data-variant="accent">今すぐ実行</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="fn-xidmerge-new">
            <span className="fn-eyebrow" style={{ display:"block",marginBottom:10 }}>新規統合申請を作成</span>
            <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
              <div className="fn-xlink-input-wrap" style={{ flex:1,minWidth:120 }}>
                <span className="fn-xlink-at fn-mono">@</span>
                <input className="fn-input fn-mono" style={{ paddingLeft:32 }} placeholder="統合元ハンドル（旧）" />
              </div>
              <span className="fn-mono" style={{ color:"var(--text-muted)" }}>→</span>
              <div className="fn-xlink-input-wrap" style={{ flex:1,minWidth:120 }}>
                <span className="fn-xlink-at fn-mono">@</span>
                <input className="fn-input fn-mono" style={{ paddingLeft:32 }} placeholder="統合先ハンドル（新）" />
              </div>
              <button className="fn-btn" data-variant="accent">申請作成</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="fn-xidmerge-list">
          {MERGE_REVERTS.map(rv => (
            <div key={rv.id} className="fn-xidmerge-card">
              <div className="fn-xidmerge-head">
                <span className="fn-jp" style={{ fontSize:13 }}>統合 #{rv.mergeId} の差し戻し申請</span>
                <span className="fn-pill" data-tone={rv.status==="pending"?"warn":"muted"}>{rv.status}</span>
                <span className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)",marginLeft:"auto" }}>{rv.requestedAt}</span>
              </div>
              <div className="fn-xidmerge-ids" style={{ padding:"10px 0" }}>
                <span className="fn-mono fn-xidmerge-from"><i className="fa-brands fa-x-twitter"></i> @{rv.from}</span>
                <span className="fn-mono fn-xidmerge-arrow">← 元に戻す</span>
                <span className="fn-mono fn-xidmerge-to"><i className="fa-brands fa-x-twitter"></i> @{rv.to}</span>
              </div>
              <div className="fn-admin-xid-ops">
                <button className="fn-btn" data-size="sm" data-variant="ghost">却下</button>
                <button className="fn-btn" data-size="sm" data-variant="accent">差し戻し承認 → 実行</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── YouTube Sync ─────────────────────────────────────────────────
function AdminYTSync({ videos }) {
  const SYNC_LOG = [
    { vid: videos[0].id, title: videos[0].title, status: "ok",      duration: "0.8s",  time: "07/25 20:05" },
    { vid: videos[1].id, title: videos[1].title, status: "ok",      duration: "1.1s",  time: "07/25 20:04" },
    { vid: videos[2].id, title: videos[2].title, status: "ok",      duration: "0.9s",  time: "07/25 20:04" },
    { vid: videos[3].id, title: videos[3].title, status: "skip",    duration: "—",     time: "07/25 20:03", note: "未公開" },
    { vid: videos[4].id, title: videos[4].title, status: "error",   duration: "5.0s",  time: "07/24 22:00", note: "404 Not Found" },
  ];
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">YouTube 同期</h2>
        <button className="fn-btn" data-variant="accent" data-size="sm"><i className="fa-solid fa-rotate"></i> 今すぐ全同期</button>
      </div>
      <div className="fn-ytsync-stats fn-mono">
        <span><span style={{ color:"var(--ok)" }}>✓ 成功</span> 3</span>
        <span><span style={{ color:"var(--text-muted)" }}>↷ スキップ</span> 1</span>
        <span><span style={{ color:"var(--danger,#ff5a5f)" }}>✕ エラー</span> 1</span>
        <span style={{ color:"var(--text-faint)" }}>最終実行: 07/25 20:05</span>
      </div>
      <table className="fn-admin-xid-tbl">
        <thead><tr><th>動画</th><th>状態</th><th>処理時間</th><th>実行時刻</th><th>メモ</th></tr></thead>
        <tbody>
          {SYNC_LOG.map((l, i) => (
            <tr key={i} className="fn-admin-xid-row">
              <td style={{ fontSize:13 }}>{l.title}</td>
              <td>
                <span className="fn-mono" style={{ fontSize:11,fontWeight:700,
                  color: l.status==="ok"?"var(--ok)": l.status==="error"?"var(--danger,#ff5a5f)":"var(--text-muted)"
                }}>{l.status.toUpperCase()}</span>
              </td>
              <td className="fn-mono" style={{ fontSize:11 }}>{l.duration}</td>
              <td className="fn-mono" style={{ fontSize:11 }}>{l.time}</td>
              <td className="fn-jp" style={{ fontSize:11,color:"var(--text-muted)" }}>{l.note || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Health ───────────────────────────────────────────────────────
const HEALTH_CHECKS = [
  { name: "D1 接続",          status: "ok",   latency: "4ms",   detail: "スキーマバージョン 42" },
  { name: "KV ガード",        status: "ok",   latency: "2ms",   detail: "mode=normal" },
  { name: "R2 バケット",       status: "ok",   latency: "12ms",  detail: "fn-assets" },
  { name: "YouTube API",      status: "ok",   latency: "88ms",  detail: "quota: 84/10000" },
  { name: "Discord OAuth",    status: "ok",   latency: "120ms", detail: "token valid" },
  { name: "Durable Objects",  status: "warn", latency: "200ms", detail: "若干高め" },
  { name: "CF Workers",       status: "ok",   latency: "18ms",  detail: "node.0426" },
];

function AdminHealth() {
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">ヘルス</h2>
        <span className="fn-mono" style={{ fontSize:11,color:"var(--ok)" }}>全サービス正常 (1 警告)</span>
      </div>
      <div className="fn-health-grid">
        {HEALTH_CHECKS.map((c, i) => (
          <div key={i} className={"fn-health-card fn-health-card--"+c.status}>
            <div className="fn-health-card-head">
              <i className={"fa-solid fn-health-icon " + (c.status==="ok"?"fa-circle-check":c.status==="warn"?"fa-triangle-exclamation":"fa-circle-xmark")}
                 style={{ color: c.status==="ok"?"var(--ok)":c.status==="warn"?"var(--warn)":"var(--danger,#ff5a5f)" }}></i>
              <span className="fn-health-name fn-mono">{c.name}</span>
            </div>
            <div className="fn-mono fn-health-latency">{c.latency}</div>
            <div className="fn-jp fn-health-detail" style={{ fontSize:11,color:"var(--text-muted)" }}>{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Security ─────────────────────────────────────────────────────
function AdminSecurity() {
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">セキュリティ</h2>
      </div>
      <div className="fn-security-list">
        {[
          { label: "Discord OAuth コールバック URL", val: "https://flamenode.example/api/auth/callback", hint: "OAuth2 redirect_uri。変更には Discord Developer Portal での更新が必要です。" },
          { label: "管理者ロール Discord ユーザー ID", val: "3件設定済み", hint: "admin ロールはこのリストの Discord ID のみに付与されます。" },
          { label: "CSP ポリシー", val: "厳格モード（inline script 禁止）", hint: null },
          { label: "CORS 許可オリジン", val: "同一オリジンのみ", hint: null },
          { label: "Rate limit（API）", val: "100 req / min / IP", hint: "Cloudflare Workers Rate Limiting で適用。" },
        ].map((item, i) => (
          <div key={i} className="fn-security-item">
            <span className="fn-eyebrow">{item.label}</span>
            <code className="fn-mono fn-security-val">{item.val}</code>
            {item.hint && <span className="fn-jp fn-field-hint">{item.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin Settings ──────────────────────────────────────────────
function AdminSettings() {
  const [termsTxt, setTermsTxt] = _adUs("FlameNodeを利用することで、本規約に同意したものとみなします。...");
  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">設定</h2>
      </div>
      <div className="fn-admin-settings-grid">
        <section className="fn-fsec">
          <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">01</span><h3 className="fn-edit-section-title">利用規約</h3></div></div>
          <div className="fn-fsec-body">
            <label className="fn-field">
              <span className="fn-field-label">利用規約テキスト（Markdown）</span>
              <textarea className="fn-input fn-chapcomp-note-ta" rows={6} value={termsTxt} onChange={e => setTermsTxt(e.target.value)} />
            </label>
            <button className="fn-btn" data-variant="accent">規約を更新 →</button>
          </div>
        </section>
        <section className="fn-fsec">
          <div className="fn-fsec-head"><div className="fn-fsec-titles"><span className="fn-fsec-num fn-mono">02</span><h3 className="fn-edit-section-title">機能フラグ</h3></div></div>
          <div className="fn-fsec-body">
            {[
              { label:"新規ユーザー登録を許可", val:true },
              { label:"投稿を一時停止",         val:false },
              { label:"イベントリストを公開",    val:true },
              { label:"メンテナンスバナー表示",  val:false },
            ].map((f, i) => (
              <div key={i} className="fn-chapcomp-toggle" style={{ justifyContent:"space-between" }}>
                <span className="fn-jp">{f.label}</span>
                <button className={"fn-switch " + (f.val ? "is-on" : "")}><span className="fn-switch-knob" /></button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { AdminPage });
