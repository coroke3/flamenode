// Top page composition

function TopPage({ onNav, lang, forceStatus }) {
  const events = window.FN_EVENTS;
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const heroEvent = events[0];

  const recommended = videos.slice().sort((a, b) => b.score - a.score);
  const latest = videos.slice().sort((a, b) => (a.posted < b.posted ? 1 : -1));

  return (
    <main className="fn-main" data-screen-label="Top">
      {/* ── Intro band ──────────────────────────────── */}
      <section className="fn-wrap fn-intro">
        <div className="fn-intro-meta">
          <h1 className="fn-display fn-intro-title">
            Video<br /><span className="fn-intro-accent">Nodes</span>
          </h1>
          <p className="fn-intro-lead fn-jp">
            個人制作映像のアーカイブと、イベントを束ねるプラットフォーム。
          </p>
          <div className="fn-intro-stats">
            <div className="fn-stat">
              <span className="fn-stat-v fn-display">1,284</span>
              <span className="fn-stat-k fn-jp">作品</span>
            </div>
            <div className="fn-stat">
              <span className="fn-stat-v fn-display">412</span>
              <span className="fn-stat-k fn-jp">クリエイター</span>
            </div>
            <div className="fn-stat">
              <span className="fn-stat-v fn-display">2</span>
              <span className="fn-stat-k fn-jp">開催中イベント</span>
            </div>
          </div>
        </div>
        <aside className="fn-intro-aside">
          <EventRecruitmentCard event={heroEvent} lang={lang} forceStatus={forceStatus} onOpen={() => onNav("event", { event: heroEvent.id })} />
        </aside>
      </section>

      {/* ── Pickup ──────────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="今週のピックアップ" jp="Selected by editors" moreLabel="すべて見る" onMore={() => onNav("list")} />
        <Shelf ariaLabel="Pickup">
          {recommended.map((v) => (
            <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
          ))}
        </Shelf>
      </section>

      {/* ── Creators ────────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="注目クリエイター" jp="Featured artists" moreLabel="すべて見る" onMore={() => onNav("creator")} />
        <div className="fn-shelf fn-shelf--creators">
          <div className="fn-shelf-strip" aria-label="creators">
            {creators.map((c) => (
              <CreatorCard key={c.id} creator={c} onOpen={() => onNav("creator")} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Latest ──────────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="新着アップロード" jp="Just dropped" moreLabel="すべて見る" onMore={() => onNav("list")} />
        <Shelf ariaLabel="Latest">
          {latest.map((v) => (
            <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
          ))}
        </Shelf>
      </section>

      {/* ── Events ──────────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="募集中のイベント" jp="Open for entry" moreLabel="イベント一覧" onMore={() => onNav("events")} />
        <div className="fn-evlist-grid">
          {events.filter(e => window.categorizeEvent(e) === "open").map(ev => (
            <EventCard key={ev.id} event={ev} lang={lang} onOpen={() => onNav("event", { event: ev.id })} />
          ))}
        </div>
      </section>

      {/* ── Past events ─────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="開催済みイベント" jp="Past events" moreLabel="すべて見る" onMore={() => onNav("events")} />
        <div className="fn-evlist-grid">
          {events.filter(e => window.categorizeEvent(e) === "ended").map(ev => (
            <EventCard key={ev.id} event={ev} lang={lang} onOpen={() => onNav("event", { event: ev.id })} />
          ))}
        </div>
      </section>

      {/* ── Archive ─────────────────────────────────── */}
      <section className="fn-wrap fn-section">
        <SectionHeader title="アーカイブ" jp="Always-on archive" moreLabel="アーカイブを見る" onMore={() => onNav("list")} />
        <div className="fn-evlist-grid">
          {events.filter(e => window.categorizeEvent(e) === "archive").map(ev => (
            <EventCard key={ev.id} event={ev} lang={lang} onOpen={() => onNav("event", { event: ev.id })} />
          ))}
          <div className="fn-archive-cta" onClick={() => onNav("list")}>
            <span className="fn-display fn-archive-cta-num">1,284</span>
            <span className="fn-jp fn-archive-cta-label">公開作品をすべて見る →</span>
          </div>
        </div>
      </section>

      {/* ── Closing ─────────────────────────────────── */}
      <section className="fn-wrap fn-closing">
        <div className="fn-closing-line">
          <span className="fn-display fn-closing-text">Upload your frame.</span>
          <span className="fn-jp fn-closing-jp">あなたのフレームをアーカイブに残す。</span>
        </div>
        <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("event", { event: ev.id })}>新規投稿を始める →</button>
      </section>
    </main>
  );
}

Object.assign(window, { TopPage });
