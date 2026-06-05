// Manage event page — /manage/events/[id]
// Staff view: stats, pending videos, notification feed, sub-navigation

const { useState: _mgUs } = React;

const NOTIF_CATEGORIES = [
  { id: "all",     label: "すべて" },
  { id: "video",   label: "動画" },
  { id: "x_id",    label: "X ID" },
  { id: "slot",    label: "枠" },
  { id: "chapter", label: "チャプター" },
  { id: "system",  label: "システム" },
];

const MOCK_NOTIFS = [
  { cat: "video",   icon: "fa-film",          text: "結節線 が提出されました",              sub: "by frame_index · 07/25 20:11", tone: "warn" },
  { cat: "video",   icon: "fa-circle-check",  text: "夜更けの導線 を承認・公開しました",    sub: "by halo_loop_v · 07/25 19:42", tone: "ok" },
  { cat: "x_id",    icon: "fa-id-badge",      text: "X ID 申請: @new_creator_01",           sub: "Discord: user#1234 · 07/25 14:00", tone: "warn" },
  { cat: "slot",    icon: "fa-calendar",      text: "08/30 21:00 枠が確保されました",        sub: "by ぬいとん (@nuiton_studio) · 07/24 22:30", tone: "muted" },
  { cat: "slot",    icon: "fa-rotate-left",   text: "08/30 20:00 枠が再取得対象に",          sub: "X ID却下のため · 07/24 18:00", tone: "warn" },
  { cat: "chapter", icon: "fa-list",          text: "Pale Index にチャプターが追加されました", sub: "by rin_otsuka_ · 07/23 11:00", tone: "muted" },
  { cat: "system",  icon: "fa-gear",          text: "KV同期完了 · slot-guard=NORMAL",        sub: "2025-07-25 00:00 JST", tone: "muted" },
  { cat: "video",   icon: "fa-triangle-exclamation", text: "Drift Section 楽曲クレジット要確認", sub: "by negativecue · 07/22 18:30", tone: "warn" },
];

function ManageEventPage({ onNav, selectedEvent }) {
  const events = window.FN_EVENTS;
  const event = events.find(e => e.id === selectedEvent) || events[0];
  const videos = window.FN_VIDEOS.filter(v => v.event === event.id);
  const creators = window.FN_CREATORS;
  const [notifCat, setNotifCat] = _mgUs("all");
  const [tab, setTab] = _mgUs("overview"); // overview | submissions | notifications | slots | staff

  const status = window.deriveStatus(event, "auto");
  const pending = videos.slice(0, 2);
  const filteredNotifs = notifCat === "all" ? MOCK_NOTIFS : MOCK_NOTIFS.filter(n => n.cat === notifCat);
  const pendingCount = MOCK_NOTIFS.filter(n => n.tone === "warn").length;

  const slotStats = {
    total: event.slotsTotal || 96,
    available: event.slotsAvailable || 22,
    reserved: 52,
    submitted: 22,
  };

  return (
    <main className="fn-main" data-screen-label="ManageEvent">
      <div className="fn-wrap">
        {/* Header */}
        <header className="fn-manage-head">
          <div className="fn-manage-head-left">
            <button className="fn-cp-back fn-mono" onClick={() => onNav("admin")}>← 運営コンソール</button>
            <span className="fn-eyebrow">manage · {event.code}</span>
            <h1 className="fn-display fn-manage-title">{event.title}</h1>
            <span className="fn-jp fn-manage-subtitle">{event.summary}</span>
          </div>
          <div className="fn-manage-head-actions">
            <span className="fn-pill" data-tone={status.kind === "entry" || status.kind === "submit" ? "accent" : "muted"}>
              {window.statusLabel(status.kind, "ja")}
            </span>
            {pendingCount > 0 && <span className="fn-pill" data-tone="warn">{pendingCount} 件要対応</span>}
            <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("event", { event: event.id })}>
              公開ページ <i className="fa-solid fa-arrow-up-right-from-square"></i>
            </button>
          </div>
        </header>

        {/* Sub-nav */}
        <nav className="fn-manage-tabs">
          {[
            { id: "overview",       label: "概要",    icon: "fa-gauge" },
            { id: "submissions",    label: "提出作品", icon: "fa-film",    badge: pending.length },
            { id: "notifications",  label: "通知",    icon: "fa-bell",    badge: pendingCount },
            { id: "slots",          label: "枠管理",  icon: "fa-calendar" },
            { id: "staff",          label: "スタッフ", icon: "fa-users" },
          ].map(t => (
            <button key={t.id} className={"fn-manage-tab " + (tab === t.id ? "is-active" : "")} onClick={() => setTab(t.id)}>
              <i className={"fa-solid " + t.icon}></i>
              <span>{t.label}</span>
              {t.badge > 0 && <span className="fn-admin-tab-badge fn-mono">{t.badge}</span>}
            </button>
          ))}
        </nav>

        {/* Overview tab */}
        {tab === "overview" && (
          <div className="fn-manage-overview">
            {/* Stats */}
            <div className="fn-manage-stats">
              {[
                { k: "提出作品（公開）", v: event.entries, sub: "うち2件レビュー待ち", tone: "" },
                { k: "クリエイター",     v: event.creators, sub: "51名参加",          tone: "" },
                { k: "残り枠",          v: slotStats.available + "/" + slotStats.total, sub: "確保済み: " + slotStats.reserved, tone: "" },
                { k: "要対応通知",       v: pendingCount,   sub: "X ID 2件・動画 1件", tone: "warn" },
              ].map((s, i) => (
                <div key={i} className={"fn-manage-stat " + (s.tone === "warn" ? "fn-manage-stat--warn" : "")}>
                  <span className="fn-eyebrow">{s.k}</span>
                  <span className="fn-display fn-manage-stat-v">{String(s.v)}</span>
                  <span className="fn-mono fn-manage-stat-sub">{s.sub}</span>
                </div>
              ))}
            </div>

            {/* Pending video queue */}
            <section className="fn-manage-section">
              <div className="fn-manage-section-head">
                <h2 className="fn-eyebrow fn-manage-section-title">直近の審査待ち</h2>
                <button className="fn-link fn-mono" onClick={() => setTab("submissions")}>すべて見る</button>
              </div>
              <ul className="fn-manage-pending">
                {pending.map((v, i) => {
                  const c = creators.find(cr => cr.id === v.creator);
                  return (
                    <li key={v.id} className="fn-manage-pending-row">
                      <div className="fn-manage-pending-thumb"><Thumb video={v} /></div>
                      <div className="fn-manage-pending-info">
                        <span className="fn-manage-pending-title">{v.title}</span>
                        <span className="fn-mono fn-manage-pending-meta">{v.code} · {c?.name}</span>
                      </div>
                      <span className="fn-pill" data-tone="warn">審査待ち</span>
                      <button className="fn-btn" data-size="sm" data-variant="accent" onClick={() => onNav("video", { video: v.id })}>
                        確認 →
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Recent activity */}
            <section className="fn-manage-section">
              <div className="fn-manage-section-head">
                <h2 className="fn-eyebrow fn-manage-section-title">最近のアクティビティ</h2>
                <button className="fn-link fn-mono" onClick={() => setTab("notifications")}>すべて見る</button>
              </div>
              <ul className="fn-notif-list">
                {MOCK_NOTIFS.slice(0, 5).map((n, i) => (
                  <li key={i} className="fn-notif-row">
                    <i className={"fn-notif-icon fa-solid " + n.icon} data-tone={n.tone}></i>
                    <div className="fn-notif-body">
                      <span className="fn-jp fn-notif-text">{n.text}</span>
                      <span className="fn-mono fn-notif-sub">{n.sub}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {/* Submissions tab */}
        {tab === "submissions" && (
          <div className="fn-manage-submissions">
            <table className="fn-admin-xid-tbl fn-manage-sub-tbl">
              <thead>
                <tr><th>作品</th><th>クリエイター</th><th>スロット</th><th>状態</th><th></th></tr>
              </thead>
              <tbody>
                {videos.map((v, i) => {
                  const c = creators.find(cr => cr.id === v.creator);
                  const statuses = ["public","public","pending","public","public"];
                  const stMap = { public: { label: "公開中", tone: "ok" }, pending: { label: "審査待ち", tone: "warn" } };
                  const st = stMap[statuses[i % statuses.length]] || stMap.public;
                  return (
                    <tr key={v.id} className="fn-admin-xid-row">
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <div style={{ width: 64, flexShrink: 0 }}><Thumb video={v} /></div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{v.title}</div>
                            <div className="fn-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{v.code}</div>
                          </div>
                        </div>
                      </td>
                      <td>{c?.name}</td>
                      <td className="fn-mono">08/{28 + (i % 3)} {["19","20","21"][i % 3]}:00</td>
                      <td><span className="fn-pill" data-tone={st.tone}>{st.label}</span></td>
                      <td>
                        <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("video", { video: v.id })}>詳細</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Notifications tab */}
        {tab === "notifications" && (
          <div className="fn-manage-notifs">
            <div className="fn-manage-notif-filter">
              {NOTIF_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  className={"fn-cp-filter-btn " + (notifCat === c.id ? "is-active" : "")}
                  onClick={() => setNotifCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <ul className="fn-notif-list">
              {filteredNotifs.map((n, i) => (
                <li key={i} className="fn-notif-row">
                  <i className={"fn-notif-icon fa-solid " + n.icon} data-tone={n.tone}></i>
                  <div className="fn-notif-body">
                    <span className="fn-jp fn-notif-text">{n.text}</span>
                    <span className="fn-mono fn-notif-sub">{n.sub}</span>
                  </div>
                  <span className="fn-mono fn-notif-time">{n.cat}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Slots tab */}
        {tab === "slots" && (
          <div className="fn-manage-section">
            <div className="fn-manage-stats" style={{ marginBottom: 24 }}>
              {[
                { k: "TOTAL", v: slotStats.total },
                { k: "AVAILABLE", v: slotStats.available },
                { k: "RESERVED", v: slotStats.reserved },
                { k: "SUBMITTED", v: slotStats.submitted },
              ].map((s, i) => (
                <div key={i} className="fn-manage-stat">
                  <span className="fn-eyebrow">{s.k}</span>
                  <span className="fn-display fn-manage-stat-v">{s.v}</span>
                </div>
              ))}
            </div>
            <button className="fn-btn" data-variant="accent" onClick={() => onNav("reserve", { event: event.id })}>
              枠管理ページを開く →
            </button>
          </div>
        )}

        {/* Staff tab */}
        {tab === "staff" && (
          <div className="fn-manage-section">
            <table className="fn-admin-xid-tbl">
              <thead>
                <tr><th>名前</th><th>X / @</th><th>役職</th><th>権限</th></tr>
              </thead>
              <tbody>
                {[
                  { name: "halo / loop",  handle: "halo_loop_v",   role: "representative", perms: "ALL" },
                  { name: "frame index",  handle: "frame_index__", role: "editor",         perms: "videos · review" },
                  { name: "凜・大塚",      handle: "rin_otsuka_",   role: "editor",         perms: "event · questions" },
                  { name: "ことりのす",    handle: "kotorinosu_mv", role: "collaborator",   perms: "music credit" },
                ].map((s, i) => (
                  <tr key={i} className="fn-admin-xid-row">
                    <td>{s.name}</td>
                    <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{s.handle}</td>
                    <td><span className="fn-pill" data-tone={i === 0 ? "accent" : "muted"}>{s.role}</span></td>
                    <td className="fn-mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{s.perms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="fn-btn" data-variant="ghost" style={{ marginTop: 14 }}>
              <i className="fa-solid fa-plus"></i> スタッフを追加
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { ManageEventPage });
