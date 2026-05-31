// Video detail page

const { useState: _vUseState } = React;

function VideoDetail({ onNav, lang, selectedVideo }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const chapters = window.FN_CHAPTERS;
  const comments = window.FN_COMMENTS;
  const video = videos.find(v => v.id === selectedVideo) || videos[2];
  const creator = creators.find(c => c.id === video.creator);
  const event = window.FN_EVENTS.find(e => e.id === video.event);

  const [m, s] = video.duration.split(":").map(Number);
  const durSec = m * 60 + s;
  const [currentSec, setCurrentSec] = _vUseState(67);
  const [tab, setTab] = _vUseState("chapters");

  const fmt = (sec) => {
    const M = Math.floor(sec / 60); const S = Math.floor(sec % 60);
    return String(M).padStart(2, "0") + ":" + String(S).padStart(2, "0");
  };

  const related = videos.filter(v => v.id !== video.id);

  return (
    <main className="fn-main" data-screen-label="VideoDetail">
      <div className="fn-vd">
        {/* ── Header strip ─────────────────────────── */}
        <div className="fn-wrap fn-vd-header">
          <div className="fn-vd-breadcrumb fn-mono">
            <span>イベント</span><span>›</span>
            <span>{event.code}</span><span>›</span>
            <span style={{ color: "var(--text-primary)" }}>{video.code}</span>
          </div>
          <div className="fn-vd-actions">
            <button className="fn-btn" data-size="sm" data-variant="ghost">共有</button>
            <button className="fn-btn" data-size="sm" data-variant="ghost">保存</button>
            <button className="fn-btn" data-size="sm">＋ 再生リスト</button>
          </div>
        </div>

        {/* ── Main grid ─────────────────────── */}
        <div className="fn-wrap fn-vd-grid">
          {/* Center: player first, then title + meta (EventArchives style) */}
          <div className="fn-vd-center">
            <Player video={video} currentSec={currentSec} setCurrentSec={setCurrentSec} durSec={durSec} chapters={chapters} comments={comments} />

            <div className="fn-vd-titleblock">
              <h1 className="fn-display fn-vd-title">{video.title}</h1>
              <div className="fn-vd-titledivider" />
              <div className="fn-vd-creator">
                <span className="fn-vcard-avatar" style={{ width: 40, height: 40, fontSize: 17 }}>{creator.name.charAt(0)}</span>
                <div className="fn-vd-creator-id">
                  <div className="fn-vd-creator-name">{creator.name}</div>
                  <div className="fn-vd-creator-sub">
                    <button className="fn-vd-sns" aria-label="X"><i className="fa-brands fa-x-twitter"></i></button>
                    <button className="fn-vd-sns" aria-label="YouTube"><i className="fa-brands fa-youtube"></i></button>
                    <span className="fn-vd-creator-works">{creator.videos} 作品</span>
                  </div>
                </div>
                <span className="fn-vd-posted fn-mono">{video.posted} 公開</span>
                <button className="fn-btn" data-size="sm" data-variant="accent">フォロー</button>
              </div>
            </div>

            <div className="fn-vd-metabar">
              <span className="fn-pill" data-tone="accent">{event.code}</span>
              <span className="fn-pill">{video.duration}</span>
              <span className="fn-pill">{video.chapters} チャプター</span>
              <span className="fn-vd-metabar-spacer" />
              <span className="fn-mono fn-vd-views">12,408 回再生 · 188 いいね</span>
            </div>

            <div className="fn-vd-tabs">
              {[
                { id: "chapters", en: "チャプター" },
                { id: "comments", en: "ノート" },
                { id: "description", en: "情報" },
              ].map(t => (
                <button key={t.id} className={"fn-vd-tab " + (tab === t.id ? "is-active" : "")} onClick={() => setTab(t.id)}>
                  <span className="fn-display">{t.en}</span>
                </button>
              ))}
            </div>

            {tab === "chapters" && (
              <ol className="fn-vd-chaplist">
                {chapters.map((c, i) => {
                  const active = currentSec >= c.time && (i === chapters.length - 1 || currentSec < chapters[i + 1].time);
                  return (
                    <li key={i} className={"fn-vd-chap " + (active ? "is-active" : "")} onClick={() => setCurrentSec(c.time)}>
                      <span className="fn-mono fn-vd-chap-time">{fmt(c.time)}</span>
                      <span className="fn-vd-chap-bar" aria-hidden="true" />
                      <span className="fn-vd-chap-label">{c.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {tab === "comments" && (
              <ol className="fn-vd-comlist">
                {comments.map((c, i) => (
                  <li key={i} className="fn-vd-com" onClick={() => setCurrentSec(c.time)}>
                    <span className="fn-mono fn-vd-com-time">{fmt(c.time)}</span>
                    <div className="fn-vd-com-body">
                      <span className="fn-mono fn-vd-com-by">@{c.by}</span>
                      <span className="fn-vd-com-text fn-jp">{c.body}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {tab === "description" && (
              <dl className="fn-vd-info">
                <dt className="fn-eyebrow">music</dt>
                <dd>{video.music}</dd>
                <dt className="fn-eyebrow">duration</dt>
                <dd className="fn-mono">{video.duration}</dd>
                <dt className="fn-eyebrow">posted</dt>
                <dd className="fn-mono">{video.posted}</dd>
                <dt className="fn-eyebrow">event</dt>
                <dd>{event.title}</dd>
                <dt className="fn-eyebrow">score</dt>
                <dd className="fn-mono">{video.score.toLocaleString()}</dd>
                <dt className="fn-eyebrow">views</dt>
                <dd className="fn-mono">12,408</dd>
              </dl>
            )}

            <div className="fn-vd-credits">
              <h3 className="fn-eyebrow">メンバー / クレジット</h3>
              <table className="fn-vd-credtable">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Name</th>
                    <th>役割</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="fn-mono">01</td><td><span className="fn-cred-name"><span className="fn-cred-avatar">{creator.name.charAt(0)}</span>{creator.name}</span></td><td>Direction / Edit</td><td className="fn-vd-cred-link"><i className="fa-brands fa-x-twitter"></i><i className="fa-brands fa-youtube"></i></td></tr>
                  <tr><td className="fn-mono">02</td><td><span className="fn-cred-name"><span className="fn-cred-avatar">K</span>KAI</span></td><td>Music</td><td className="fn-vd-cred-link"><i className="fa-brands fa-x-twitter"></i></td></tr>
                  <tr><td className="fn-mono">03</td><td><span className="fn-cred-name"><span className="fn-cred-avatar">f</span>frame index</span></td><td>Motion (asst.)</td><td className="fn-vd-cred-link"><i className="fa-brands fa-x-twitter"></i></td></tr>
                  <tr><td className="fn-mono">04</td><td><span className="fn-cred-name"><span className="fn-cred-avatar">s</span>silver leaf</span></td><td>Sound Design</td><td className="fn-vd-cred-link"><i className="fa-brands fa-x-twitter"></i></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: related */}
          <aside className="fn-vd-right">
            <div className="fn-vd-playlist">
              <div className="fn-vd-pl-head">
                <span className="fn-eyebrow">再生リスト · {event.code}</span>
                <span className="fn-mono fn-vd-pl-pos">3 / 12</span>
              </div>
              {related.slice(0, 5).map((v, i) => (
                <button key={v.id} className={"fn-vd-pl-item " + (i === 1 ? "is-now" : "")} onClick={() => onNav("video", { video: v.id })}>
                  <div className="fn-vd-pl-thumb"><Thumb video={v} /></div>
                  <div className="fn-vd-pl-info">
                    <span className="fn-vd-pl-title">{v.title}</span>
                    <span className="fn-mono fn-vd-pl-meta">{v.duration} · {creators.find(c => c.id === v.creator).name}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="fn-vd-related">
              <h3 className="fn-eyebrow">関連動画 — 同じイベント</h3>
              <ol className="fn-vd-rel-list">
                {related.slice(0, 8).map(v => (
                  <li key={v.id} className="fn-vd-rel" onClick={() => onNav("video", { video: v.id })}>
                    <div className="fn-vd-rel-thumb"><Thumb video={v} /></div>
                    <div className="fn-vd-rel-info">
                      <span className="fn-mono fn-vd-rel-code">{v.code}</span>
                      <span className="fn-vd-rel-title">{v.title}</span>
                      <span className="fn-mono fn-vd-rel-creator">{creators.find(c => c.id === v.creator).name}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

// ─── Player ─────────────────────────────────────────────────────
function Player({ video, currentSec, setCurrentSec, durSec, chapters, comments }) {
  let h = 0; for (let i = 0; i < video.id.length; i++) h = (h * 31 + video.id.charCodeAt(i)) % 360;
  const h2 = (h + 50) % 360;
  const fmt = (sec) => {
    const M = Math.floor(sec / 60); const S = Math.floor(sec % 60);
    return String(M).padStart(2, "0") + ":" + String(S).padStart(2, "0");
  };
  const onSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    setCurrentSec(Math.max(0, Math.min(durSec, durSec * pct)));
  };
  const progress = (currentSec / durSec) * 100;
  return (
    <div className="fn-player">
      <div className="fn-player-screen" style={{
        background: `linear-gradient(135deg, hsl(${h} 55% 22%), hsl(${h2} 50% 12%))`,
      }}>
        <div className="fn-player-overlay-grid" aria-hidden="true" />
        <div className="fn-player-center-play" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28"><path d="M6 4 L24 14 L6 24 Z" fill="currentColor"/></svg>
        </div>
        <div className="fn-player-tl">
          <span className="fn-mono">{video.code}</span>
        </div>
        <div className="fn-player-tr">
          <span className="fn-mono">YT.LIVE</span>
          <span className="fn-player-dot" />
        </div>
        <div className="fn-player-bl">
          <span className="fn-mono">{video.title}</span>
        </div>
      </div>
      <div className="fn-player-controls">
        <div className="fn-player-bar" onClick={onSeek}>
          <div className="fn-player-bar-bg" />
          <div className="fn-player-bar-fill" style={{ width: progress + "%" }} />
          {chapters.map((c, i) => (
            <span key={i} className="fn-player-bar-chap" style={{ left: (c.time / durSec) * 100 + "%" }} aria-hidden="true" />
          ))}
          {comments.map((c, i) => (
            <span key={i} className="fn-player-bar-com" style={{ left: (c.time / durSec) * 100 + "%" }} aria-hidden="true" />
          ))}
          <span className="fn-player-bar-handle" style={{ left: progress + "%" }} aria-hidden="true" />
        </div>
        <div className="fn-player-row">
          <button className="fn-player-icon" title="prev">‹‹</button>
          <button className="fn-player-icon fn-player-play" title="play">▶</button>
          <button className="fn-player-icon" title="next">››</button>
          <span className="fn-mono fn-player-time">{fmt(currentSec)} / {fmt(durSec)}</span>
          <span className="fn-player-spacer" />
          <button className="fn-player-icon" title="frame back">|◁</button>
          <button className="fn-player-icon" title="frame fwd">▷|</button>
          <button className="fn-player-icon" title="volume">vol</button>
          <button className="fn-player-icon" title="speed">1.0x</button>
          <button className="fn-player-icon" title="fullscreen">⛶</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { VideoDetail, Player });
