// Manage top page — /manage
// Shows events where the logged-in user has staff permissions

const { useState: _mtUs } = React;

function ManageTopPage({ onNav }) {
  const events = window.FN_EVENTS;

  // Mock staff event entries with roles
  const STAFF_EVENTS = [
    { event: events[0], role: "representative", permissions: ["ALL"], approved: true, pendingCount: 4 },
    { event: events[1], role: "editor",         permissions: ["videos", "review"], approved: true, pendingCount: 0 },
    { event: events[2], role: "collaborator",   permissions: ["music_credit"], approved: false, pendingCount: 0 },
  ];

  const RECENT_ACTIVITY = [
    { icon: "fa-film",   text: "結節線 が提出されました",          event: "PVSF2025S", time: "07/25 20:11", tone: "warn" },
    { icon: "fa-id-badge", text: "X ID 申請 3件 承認待ち",         event: "PVSF2025S", time: "07/25 14:00", tone: "warn" },
    { icon: "fa-calendar", text: "08/30 20:00 枠が確保されました", event: "PVSF2025S", time: "07/24 22:30", tone: "muted" },
    { icon: "fa-circle-check", text: "夜更けの導線 を承認・公開",    event: "PVSF2025S", time: "07/25 19:42", tone: "ok" },
    { icon: "fa-users",  text: "ことりのす がスタッフに追加されました", event: "NCNC2025", time: "07/20 10:00", tone: "muted" },
  ];

  return (
    <main className="fn-main" data-screen-label="ManageTop">
      <div className="fn-wrap">
        <header className="fn-cr-head">
          <div>
            <span className="fn-eyebrow">manage · イベント運営</span>
            <h1 className="fn-display fn-cr-title">イベント運営</h1>
            <p className="fn-jp fn-cr-sub">スタッフ権限を持つイベントの管理ページです。</p>
          </div>
          <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("admin")}>
            <i className="fa-solid fa-shield-halved"></i> 管理コンソール
          </button>
        </header>

        <div className="fn-divider" />

        <div className="fn-manage-top-grid">
          {/* Events list */}
          <div className="fn-manage-top-events">
            <h2 className="fn-eyebrow" style={{ padding:"18px 0 12px" }}>担当イベント</h2>
            <div className="fn-manage-event-list">
              {STAFF_EVENTS.map((se, i) => {
                const ev = se.event;
                const status = window.deriveStatus(ev, "auto");
                const label = window.statusLabel(status.kind, "ja");
                return (
                  <article key={ev.id} className={"fn-manage-ev-card " + (!se.approved ? "fn-manage-ev-card--pending" : "")}>
                    <div className="fn-manage-ev-card-head">
                      <div>
                        <div className="fn-manage-ev-card-meta">
                          <span className="fn-mono fn-manage-ev-code">{ev.code}</span>
                          <span className="fn-pill" data-tone={status.kind==="entry"||status.kind==="submit"?"accent":"muted"}>{label}</span>
                          <span className="fn-pill" data-tone={se.role==="representative"?"accent":se.role==="editor"?"muted":"muted"}>{se.role}</span>
                          {!se.approved && <span className="fn-pill" data-tone="warn">権限承認待ち</span>}
                        </div>
                        <h3 className="fn-display fn-manage-ev-title">{ev.title}</h3>
                        <p className="fn-jp fn-manage-ev-summary">{ev.summary}</p>
                      </div>
                      {se.pendingCount > 0 && (
                        <span className="fn-manage-ev-pending fn-mono">{se.pendingCount} 件要対応</span>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="fn-manage-ev-stats">
                      <span className="fn-eyebrow">エントリー</span>
                      <span className="fn-mono">{ev.entries}</span>
                      <span className="fn-manage-ev-sep" />
                      <span className="fn-eyebrow">クリエイター</span>
                      <span className="fn-mono">{ev.creators}</span>
                      <span className="fn-manage-ev-sep" />
                      <span className="fn-eyebrow">残り枠</span>
                      <span className="fn-mono">{ev.slotsAvailable}/{ev.slotsTotal||96}</span>
                    </div>

                    {/* Sub-nav */}
                    {se.approved && (
                      <nav className="fn-manage-ev-nav">
                        {[
                          { id:"manageEvent", icon:"fa-gauge",    label:"概要" },
                          { id:"manageSlots", icon:"fa-calendar", label:"スロット" },
                          { id:"manageAudience",icon:"fa-users",  label:"登録者" },
                          { id:"manageStaff", icon:"fa-user-shield",label:"スタッフ" },
                        ].map(n => (
                          <button
                            key={n.id}
                            className="fn-manage-ev-nav-btn"
                            onClick={() => onNav(n.id, { event: ev.id })}
                          >
                            <i className={"fa-solid "+n.icon}></i>
                            <span>{n.label}</span>
                          </button>
                        ))}
                      </nav>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          {/* Recent activity */}
          <aside className="fn-manage-top-aside">
            <h2 className="fn-eyebrow" style={{ padding:"18px 0 12px" }}>最近のアクティビティ</h2>
            <ul className="fn-notif-list">
              {RECENT_ACTIVITY.map((a, i) => (
                <li key={i} className="fn-notif-row">
                  <i className={"fn-notif-icon fa-solid "+a.icon} data-tone={a.tone}></i>
                  <div className="fn-notif-body">
                    <span className="fn-jp fn-notif-text">{a.text}</span>
                    <span className="fn-mono fn-notif-sub">{a.event} · {a.time}</span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </main>
  );
}

// ─── Manage Event Slots ───────────────────────────────────────────
function ManageSlotsPage({ onNav, selectedEvent }) {
  const event = window.FN_EVENTS.find(e => e.id === selectedEvent) || window.FN_EVENTS[0];
  const [filter, setFilter] = React.useState("all");
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;

  // Flatten matrix to rows for table view
  const allSlots = [];
  days.forEach((d, di) => hours.forEach((h, hi) => {
    const c = matrix[di][hi];
    allSlots.push({ day: d, hour: h, ...c, di, hi });
  }));
  const filtered = filter === "all" ? allSlots : allSlots.filter(s => s.status === filter);

  const STATUS_COUNTS = {
    all: allSlots.length,
    available: allSlots.filter(s=>s.status==="available").length,
    reserved:  allSlots.filter(s=>s.status==="reserved").length,
    submitted: allSlots.filter(s=>s.status==="submitted").length,
    reclaim:   allSlots.filter(s=>s.status==="reclaim").length,
  };

  return (
    <main className="fn-main" data-screen-label="ManageSlots">
      <div className="fn-wrap">
        <button className="fn-cp-back fn-mono" style={{ marginTop:20,display:"block" }} onClick={() => onNav("manageTop")}>
          ← イベント運営 / {event.code}
        </button>
        <header className="fn-manage-head" style={{ marginTop:12 }}>
          <div className="fn-manage-head-left">
            <span className="fn-eyebrow">manage / {event.code} / slots</span>
            <h1 className="fn-display fn-manage-title" style={{ fontSize:"clamp(28px,4vw,48px)" }}>スロット運営</h1>
          </div>
          <div className="fn-manage-head-actions">
            <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("manageEvent", { event: event.id })}>
              イベント詳細
            </button>
          </div>
        </header>

        {/* Filter + stats */}
        <div className="fn-manage-stats" style={{ gridTemplateColumns:"repeat(5,1fr)", marginBottom:20 }}>
          {Object.entries(STATUS_COUNTS).map(([k,v]) => (
            <button
              key={k}
              className={"fn-manage-stat fn-manage-stat-btn " + (filter===k?"fn-manage-stat-btn--active":"")}
              onClick={() => setFilter(k)}
              style={{ cursor:"pointer" }}
            >
              <span className="fn-eyebrow">{k.toUpperCase()}</span>
              <span className="fn-display fn-manage-stat-v">{v}</span>
            </button>
          ))}
        </div>

        <table className="fn-admin-xid-tbl">
          <thead><tr><th>日</th><th>時刻</th><th>状態</th><th>名前</th><th></th></tr></thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={i} className="fn-admin-xid-row">
                <td className="fn-mono" style={{ fontSize:12 }}>{s.day}</td>
                <td className="fn-mono">{s.hour}</td>
                <td>
                  <span
                    className="fn-pill"
                    data-tone={s.status==="submitted"?"accent":s.status==="reserved"?"muted":s.status==="reclaim"?"warn":"muted"}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="fn-jp" style={{ fontSize:13 }}>{s.name ?? "—"}</td>
                <td className="fn-admin-xid-ops">
                  {s.status === "available" && (
                    <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("reserve", { event: event.id })}>
                      確保
                    </button>
                  )}
                  {s.status === "submitted" && (
                    <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("video")}>
                      動画確認
                    </button>
                  )}
                  {s.status === "reclaim" && (
                    <button className="fn-btn" data-size="sm" data-variant="ghost">
                      再取得解除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// ─── Manage Audience ──────────────────────────────────────────────
function ManageAudiencePage({ onNav, selectedEvent }) {
  const event = window.FN_EVENTS.find(e => e.id === selectedEvent) || window.FN_EVENTS[0];
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS.filter(v => v.event === event.id);

  // Build audience from creators who have videos in this event
  const audience = creators
    .filter(c => videos.some(v => v.creator === c.id))
    .map(c => {
      const myVids = videos.filter(v => v.creator === c.id);
      return {
        creator: c,
        slots: myVids.length,
        submitted: myVids.length,
        days: ["08/30", "08/31"],
      };
    });

  return (
    <main className="fn-main" data-screen-label="ManageAudience">
      <div className="fn-wrap">
        <button className="fn-cp-back fn-mono" style={{ marginTop:20,display:"block" }} onClick={() => onNav("manageTop")}>
          ← イベント運営 / {event.code}
        </button>
        <header className="fn-manage-head" style={{ marginTop:12 }}>
          <div className="fn-manage-head-left">
            <span className="fn-eyebrow">manage / {event.code} / audience</span>
            <h1 className="fn-display fn-manage-title" style={{ fontSize:"clamp(28px,4vw,48px)" }}>登録者プレビュー</h1>
            <span className="fn-jp fn-manage-subtitle">枠を確保したクリエイターの一覧（提出状況付き）</span>
          </div>
          <div className="fn-manage-head-actions">
            <span className="fn-mono" style={{ fontSize:12,color:"var(--text-muted)" }}>
              {audience.length} クリエイター
            </span>
          </div>
        </header>

        <table className="fn-admin-xid-tbl" style={{ marginTop:20 }}>
          <thead>
            <tr>
              <th>クリエイター</th>
              <th>X ハンドル</th>
              <th>確保枠数</th>
              <th>提出済み</th>
              <th>提出日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {audience.map((a, i) => (
              <tr key={i} className="fn-admin-xid-row">
                <td>
                  <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                    <div className="fn-vcard-avatar">{a.creator.name.charAt(0)}</div>
                    <span style={{ fontWeight:600,fontSize:13 }}>{a.creator.name}</span>
                  </div>
                </td>
                <td className="fn-mono fn-admin-xid-handle">
                  <i className="fa-brands fa-x-twitter"></i> @{a.creator.handle}
                </td>
                <td className="fn-mono">{a.slots}</td>
                <td>
                  <span className="fn-pill" data-tone={a.submitted===a.slots?"ok":"warn"}>
                    {a.submitted}/{a.slots}
                  </span>
                </td>
                <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>
                  {a.days.join(" · ")}
                </td>
                <td>
                  <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("creatorProfile", { creator: a.creator.id })}>
                    プロフィール
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// ─── Manage Staff ─────────────────────────────────────────────────
function ManageStaffPage({ onNav, selectedEvent }) {
  const event = window.FN_EVENTS.find(e => e.id === selectedEvent) || window.FN_EVENTS[0];
  const [staff, setStaff] = React.useState([
    { name:"halo / loop",   handle:"halo_loop_v",   role:"representative", perms:["ALL"],                        approved:true  },
    { name:"frame index",   handle:"frame_index__", role:"editor",         perms:["videos","review"],             approved:true  },
    { name:"凜・大塚",       handle:"rin_otsuka_",   role:"editor",         perms:["event","questions"],          approved:true  },
    { name:"ことりのす",     handle:"kotorinosu_mv", role:"collaborator",   perms:["music_credit"],               approved:false },
  ]);
  const [newHandle, setNewHandle] = React.useState("");

  const addStaff = () => {
    const h = newHandle.replace(/^@/,"").trim();
    if (!h) return;
    setStaff(s => [...s, { name: h, handle: h, role:"collaborator", perms:[], approved:false }]);
    setNewHandle("");
  };
  const removeStaff = i => setStaff(s => s.filter((_,j) => j!==i));

  return (
    <main className="fn-main" data-screen-label="ManageStaff">
      <div className="fn-wrap">
        <button className="fn-cp-back fn-mono" style={{ marginTop:20,display:"block" }} onClick={() => onNav("manageTop")}>
          ← イベント運営 / {event.code}
        </button>
        <header className="fn-manage-head" style={{ marginTop:12 }}>
          <div className="fn-manage-head-left">
            <span className="fn-eyebrow">manage / {event.code} / staff</span>
            <h1 className="fn-display fn-manage-title" style={{ fontSize:"clamp(28px,4vw,48px)" }}>スタッフ管理</h1>
          </div>
        </header>

        <table className="fn-admin-xid-tbl" style={{ marginTop:20 }}>
          <thead>
            <tr><th>名前</th><th>X ハンドル</th><th>ロール</th><th>権限</th><th>状態</th><th></th></tr>
          </thead>
          <tbody>
            {staff.map((s, i) => (
              <tr key={i} className="fn-admin-xid-row">
                <td style={{ fontWeight:600,fontSize:13 }}>{s.name}</td>
                <td className="fn-mono fn-admin-xid-handle">
                  <i className="fa-brands fa-x-twitter"></i> @{s.handle}
                </td>
                <td>
                  <span className="fn-pill" data-tone={s.role==="representative"?"accent":s.role==="editor"?"muted":"muted"}>
                    {s.role}
                  </span>
                </td>
                <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>
                  {s.perms.join(" · ") || "—"}
                </td>
                <td>
                  <span className="fn-pill" data-tone={s.approved?"ok":"warn"}>
                    {s.approved?"承認済み":"承認待ち"}
                  </span>
                </td>
                <td className="fn-admin-xid-ops">
                  {!s.approved && <button className="fn-btn" data-size="sm" data-variant="accent" onClick={() => setStaff(st => st.map((x,j)=>j===i?{...x,approved:true}:x))}>承認</button>}
                  {s.role !== "representative" && (
                    <button className="fn-btn" data-size="sm" data-variant="ghost" style={{ color:"var(--danger,#ff5a5f)" }} onClick={() => removeStaff(i)}>削除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="fn-xidmerge-new" style={{ marginTop:20 }}>
          <span className="fn-eyebrow" style={{ display:"block",marginBottom:10 }}>スタッフを追加</span>
          <div className="fn-chapcomp-time-row">
            <div className="fn-xlink-input-wrap" style={{ flex:1 }}>
              <span className="fn-xlink-at fn-mono">@</span>
              <input className="fn-input fn-mono" style={{ paddingLeft:32 }} placeholder="x_handle" value={newHandle} onChange={e => setNewHandle(e.target.value.replace(/^@+/,""))} onKeyDown={e => e.key==="Enter" && addStaff()} />
            </div>
            <select className="fn-input" style={{ height:38,padding:"0 10px",fontSize:13 }}>
              <option value="editor">editor</option>
              <option value="collaborator">collaborator</option>
            </select>
            <button className="fn-btn" data-variant="accent" onClick={addStaff}>追加</button>
          </div>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { ManageTopPage, ManageSlotsPage, ManageAudiencePage, ManageStaffPage });
