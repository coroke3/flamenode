// Creator Profile page — individual creator deep page

const { useState: _cpUseState } = React;

function CreatorProfile({ onNav, selectedCreator }) {
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS;
  const events = window.FN_EVENTS;

  const creator = creators.find(c => c.id === selectedCreator) || creators[2]; // halo_loop default
  const works = videos.filter(v => v.creator === creator.id);
  const allWorks = works.length > 0 ? works : videos.slice(0, 5); // fallback for demo
  const [filter, setFilter] = _cpUseState("all");
  const [tab, setTab] = _cpUseState("works"); // works | history | about

  const filtered = filter === "all" ? allWorks : allWorks.filter(v => v.event === filter);
  const participated = events.filter((_, i) => i < 2); // mock: first 2 events

  // Pseudo-stats
  const totalScore = allWorks.reduce((acc, v) => acc + v.score, 0);
  const evCount = participated.length;

  return (
    <main className="fn-main" data-screen-label="CreatorProfile">
      <div className="fn-cp-hero">
        <div className="fn-wrap fn-cp-hero-inner">
          {/* Back breadcrumb */}
          <button className="fn-cp-back fn-mono" onClick={() => onNav("creator")}>
            ← クリエイター一覧
          </button>

          {/* Identity block */}
          <div className="fn-cp-identity">
            <div className="fn-cp-avatar fn-display">{creator.name.charAt(0)}</div>
            <div className="fn-cp-id-info">
              <h1 className="fn-display fn-cp-name">{creator.name}</h1>
              <div className="fn-cp-handles">
                <span className="fn-mono fn-cp-handle">
                  <i className="fa-brands fa-x-twitter"></i> @{creator.handle}
                </span>
                <span className="fn-mono fn-cp-handle fn-cp-handle--yt">
                  <i className="fa-brands fa-youtube"></i> youtube.com/@{creator.handle}
                </span>
              </div>
              <p className="fn-jp fn-cp-bio">
                映像作家。静止と動の境界を主題に制作。FlameNode 参加 {evCount} イベント。
              </p>
            </div>
            <div className="fn-cp-actions">
              <button className="fn-btn" data-variant="ghost" data-size="sm">
                <i className="fa-brands fa-x-twitter"></i>
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div className="fn-cp-stats">
            <div className="fn-cp-stat">
              <span className="fn-eyebrow">WORKS</span>
              <span className="fn-display fn-cp-stat-v">{String(creator.videos).padStart(2, "0")}</span>
            </div>
            <div className="fn-cp-stat">
              <span className="fn-eyebrow">EVENTS</span>
              <span className="fn-display fn-cp-stat-v">{String(evCount).padStart(2, "0")}</span>
            </div>
            <div className="fn-cp-stat">
              <span className="fn-eyebrow">TOTAL SCORE</span>
              <span className="fn-display fn-cp-stat-v">{totalScore.toLocaleString()}</span>
            </div>
            <div className="fn-cp-stat">
              <span className="fn-eyebrow">最新投稿</span>
              <span className="fn-mono fn-cp-stat-v fn-cp-stat-v--sm">{allWorks[0]?.posted || "—"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="fn-wrap fn-cp-body">
        {/* Tabs */}
        <div className="fn-cp-tabs">
          {[
            { id: "works",   label: "作品", count: allWorks.length },
            { id: "history", label: "参加履歴", count: evCount },
            { id: "about",   label: "プロフィール", count: null },
          ].map(t => (
            <button
              key={t.id}
              className={"fn-cp-tab " + (tab === t.id ? "is-active" : "")}
              onClick={() => setTab(t.id)}
            >
              <span className="fn-display">{t.label}</span>
              {t.count !== null && <span className="fn-mono fn-cp-tab-n">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Works tab */}
        {tab === "works" && (
          <div className="fn-cp-works">
            <div className="fn-cp-filter">
              {[
                { id: "all", label: "すべて" },
                ...participated.map(e => ({ id: e.id, label: e.code })),
              ].map(f => (
                <button
                  key={f.id}
                  className={"fn-cp-filter-btn " + (filter === f.id ? "is-active" : "")}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="fn-cp-works-grid">
              {(filtered.length > 0 ? filtered : allWorks).map((v, i) => (
                <VideoCard key={v.id + i} video={v} index={i + 1} onOpen={() => onNav("video", { video: v.id })} size="lg" />
              ))}
            </div>
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div className="fn-cp-history">
            {participated.map((ev, i) => {
              const evWorks = allWorks.filter(v => v.event === ev.id);
              return (
                <div key={ev.id} className="fn-cp-hist-row" onClick={() => onNav("event", { event: ev.id })}>
                  <div className="fn-cp-hist-num fn-mono">{String(i + 1).padStart(2, "0")}</div>
                  <div className="fn-cp-hist-bar" aria-hidden="true" />
                  <div className="fn-cp-hist-body">
                    <div className="fn-cp-hist-head">
                      <span className="fn-display fn-cp-hist-title">{ev.title}</span>
                      <span className="fn-pill fn-cp-hist-pill" data-tone={i === 0 ? "accent" : "muted"}>
                        {i === 0 ? "参加中" : "参加済み"}
                      </span>
                    </div>
                    <span className="fn-jp fn-cp-hist-sub">{ev.summary}</span>
                    <div className="fn-cp-hist-works">
                      {evWorks.length > 0 ? evWorks.map(v => (
                        <button
                          key={v.id}
                          className="fn-cp-hist-work fn-mono"
                          onClick={e => { e.stopPropagation(); onNav("video", { video: v.id }); }}
                        >
                          {v.title}
                        </button>
                      )) : (
                        <span className="fn-cp-hist-work fn-cp-hist-work--empty fn-jp">この期間の投稿作品なし</span>
                      )}
                    </div>
                  </div>
                  <span className="fn-mono fn-cp-hist-range">{ev.rangeText}</span>
                  <span className="fn-cp-hist-arrow">→</span>
                </div>
              );
            })}
          </div>
        )}

        {/* About tab */}
        {tab === "about" && (
          <div className="fn-cp-about">
            <section className="fn-cp-about-sec">
              <h2 className="fn-eyebrow">プロフィール</h2>
              <dl className="fn-cp-about-dl">
                <dt>活動名</dt><dd>{creator.name}</dd>
                <dt>X (Twitter)</dt><dd className="fn-mono"><i className="fa-brands fa-x-twitter"></i> @{creator.handle}</dd>
                <dt>YouTube</dt><dd className="fn-mono"><i className="fa-brands fa-youtube"></i> youtube.com/@{creator.handle}</dd>
                <dt>映像歴</dt><dd>3〜5年</dd>
                <dt>使用ツール</dt><dd>After Effects / Premiere Pro / DaVinci Resolve</dd>
              </dl>
            </section>
            <section className="fn-cp-about-sec">
              <h2 className="fn-eyebrow">FlameNode での活動</h2>
              <dl className="fn-cp-about-dl">
                <dt>登録日</dt><dd className="fn-mono">2024-03-12</dd>
                <dt>参加イベント</dt><dd>{evCount} 件</dd>
                <dt>投稿作品</dt><dd>{creator.videos} 件</dd>
                <dt>Active X ID</dt><dd className="fn-mono">@{creator.handle}</dd>
              </dl>
            </section>
            <section className="fn-cp-about-sec">
              <h2 className="fn-eyebrow">ひとこと</h2>
              <p className="fn-jp fn-cp-about-bio">
                映像と音楽の結節点を探しています。静止と動の間で、フレームを積み重ねる。<br />
                いつでも声かけてください。
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { CreatorProfile });
