// Recommend page — /recommend
// Curated shelves: latest, recommended, underrated, pickup creators

function RecommendPage({ onNav }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;

  // Simulate curated lists
  const latest       = videos.slice().sort((a,b) => b.posted < a.posted ? -1 : 1);
  const recommended  = videos.slice().sort((a,b) => b.score - a.score);
  const underrated   = videos.slice().sort((a,b) => a.score - b.score).slice(0, 6);
  const pickup       = creators.slice(0, 6);

  const Section = ({ eyebrow, title, children }) => (
    <section className="fn-rec-section fn-wrap">
      <div className="fn-section-head">
        <div className="fn-section-head-left">
          <div className="fn-section-titles">
            <span className="fn-eyebrow">{eyebrow}</span>
            <h2 className="fn-display fn-section-title">{title}</h2>
          </div>
        </div>
        <button className="fn-section-more" onClick={() => onNav("list")}>
          すべて見る <span>→</span>
        </button>
      </div>
      {children}
    </section>
  );

  return (
    <main className="fn-main" data-screen-label="Recommend">
      {/* Hero */}
      <div className="fn-wrap fn-rec-hero">
        <span className="fn-eyebrow">おすすめ · recommend</span>
        <h1 className="fn-display fn-rec-hero-title">発見する</h1>
        <p className="fn-jp fn-rec-hero-lead">編集部が選ぶ作品と、まだ見つかっていない傑作。</p>
      </div>

      {/* Featured video — hero-size card */}
      <div className="fn-wrap">
        <div className="fn-rec-feature" onClick={() => onNav("video", { video: recommended[0].id })}>
          <div className="fn-rec-feature-thumb">
            <Thumb video={recommended[0]} />
          </div>
          <div className="fn-rec-feature-body">
            <span className="fn-pill" data-tone="accent">PICKUP</span>
            <h2 className="fn-display fn-rec-feature-title">{recommended[0].title}</h2>
            <p className="fn-jp fn-rec-feature-music">{recommended[0].music}</p>
            <div className="fn-rec-feature-meta fn-mono">
              <span>{(() => { const c = creators.find(c => c.id === recommended[0].creator); return c ? c.name : ""; })()}</span>
              <span>·</span>
              <span>{recommended[0].duration}</span>
              <span>·</span>
              <span>{recommended[0].score.toLocaleString()} pts</span>
            </div>
            <button className="fn-btn" data-variant="accent" data-size="lg">
              再生する →
            </button>
          </div>
        </div>
      </div>

      {/* Latest shelf */}
      <Section eyebrow="LATEST — 新着" title="新着">
        <Shelf ariaLabel="Latest">
          {latest.map(v => (
            <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
          ))}
        </Shelf>
      </Section>

      {/* Recommended shelf */}
      <Section eyebrow="RECOMMENDED — 人気" title="おすすめ">
        <Shelf ariaLabel="Recommended">
          {recommended.map(v => (
            <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
          ))}
        </Shelf>
      </Section>

      {/* Underrated shelf */}
      <Section eyebrow="UNDERRATED — 発掘枠" title="まだ見つかっていない">
        <Shelf ariaLabel="Underrated">
          {underrated.map(v => (
            <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
          ))}
        </Shelf>
      </Section>

      {/* Pickup creators */}
      <section className="fn-rec-section fn-wrap">
        <div className="fn-section-head">
          <div className="fn-section-head-left">
            <div className="fn-section-titles">
              <span className="fn-eyebrow">PICKUP CREATORS — 注目</span>
              <h2 className="fn-display fn-section-title">注目クリエイター</h2>
            </div>
          </div>
          <button className="fn-section-more" onClick={() => onNav("creator")}>
            全員見る <span>→</span>
          </button>
        </div>
        <div className="fn-rec-creators">
          {pickup.map((c, i) => (
            <CreatorCard key={c.id} creator={c} index={i + 1} onOpen={() => onNav("creatorProfile", { creator: c.id })} />
          ))}
        </div>
      </section>
    </main>
  );
}

Object.assign(window, { RecommendPage });
