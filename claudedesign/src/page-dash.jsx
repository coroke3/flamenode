// Dashboard (creator account) + Admin (event management / approval queue)

const { useState: _dUseState } = React;

// ─── DASHBOARD ──────────────────────────────────────────────────
function Dashboard({ onNav, lang }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const me = creators[2]; // halo / loop
  const myVideos = videos.slice(0, 6);
  const [tab, setTab] = _dUseState("videos");

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
            <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("submit")}>＋ 新規投稿</button>
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

        {/* Active submissions / reserved slots */}
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
              <button className="fn-btn" data-size="sm" data-variant="accent" onClick={(e) => { e.stopPropagation(); onNav("submit"); }}>動画を提出</button>
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
                { id: "videos", label: "公開中" },
                { id: "draft", label: "下書き" },
                { id: "review", label: "レビュー中" },
              ].map(o => (
                <button key={o.id} className={"fn-cr-seg-btn " + (tab === o.id ? "is-active" : "")} onClick={() => setTab(o.id)}>
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
          </div>
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
                  <td>→</td>
                </tr>
              ))}
            </tbody>
          </table>
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

  const setReview = (idx, review) => {
    setQueue(q => q.map((item, i) => i === idx ? { ...item, review } : item));
  };

  const pendingCount = queue.filter(q => q.review === "pending").length;

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
            <span className="fn-pill" data-tone="warn">{pendingCount} 件レビュー待ち</span>
            <button className="fn-btn" data-variant="ghost" onClick={() => onNav("dashboard")}>マイページ</button>
          </div>
        </header>

        {/* Admin nav tabs */}
        <nav className="fn-admin-tabs">
          {["レビュー", "枠管理", "メンバー", "履歴", "設定"].map((t, i) => (
            <button key={t} className={"fn-admin-tab " + (i === 0 ? "is-active" : "")}>
              <span className="fn-display">{["Review", "Slots", "Members", "History", "Settings"][i]}</span>
              <span className="fn-jp fn-admin-tab-jp">{t}</span>
            </button>
          ))}
        </nav>

        {/* Review queue split */}
        <div className="fn-admin-grid">
          {/* Queue list */}
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

          {/* Review detail */}
          <div className="fn-admin-detail">
            <ReviewDetail item={queue[active]} idx={active} setReview={setReview} creators={creators} />
          </div>
        </div>
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

Object.assign(window, { Dashboard, AdminPage });
