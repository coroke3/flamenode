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
              </div>
            </div>

            <div className="fn-vd-metabar">
              <span className="fn-pill" data-tone="accent">{event.code}</span>
              <span className="fn-pill">{video.duration}</span>
              <span className="fn-pill">{video.chapters} チャプター</span>
              <span className="fn-vd-metabar-spacer" />
              <span className="fn-mono fn-vd-views">12,408 回再生 · 188 いいね</span>
              <span className="fn-vd-metabar-divider" aria-hidden="true" />
              <div className="fn-vd-quickactions">
                <button className="fn-vd-qa" aria-label="共有"><i className="fa-solid fa-arrow-up-from-bracket"></i><span>共有</span></button>
                <button className="fn-vd-qa" aria-label="保存"><i className="fa-regular fa-bookmark"></i><span>保存</span></button>
                <button className="fn-vd-qa" aria-label="再生リストに追加"><i className="fa-solid fa-plus"></i><span>再生リスト</span></button>
              </div>
            </div>

            <div className="fn-vd-tabs">
              {[
                { id: "chapterComments", label: "チャプターコメント" },
                { id: "compose",        label: "追加" },
                { id: "description",    label: "情報" },
              ].map(t => (
                <button key={t.id} className={"fn-vd-tab " + (tab === t.id ? "is-active" : "")} onClick={() => setTab(t.id)}>
                  <span>{t.label}</span>
                  {t.id === "chapterComments" && <span className="fn-mono fn-vd-tab-n">{chapters.length}</span>}
                </button>
              ))}
            </div>

            {tab === "chapterComments" && (
              <ol className="fn-chapcom-list">
                {chapters.map((c, i) => {
                  const active = currentSec >= c.time && (i === chapters.length - 1 || currentSec < chapters[i + 1].time);
                  return (
                    <li
                      key={i}
                      className={"fn-chapcom " + (active ? "is-active" : "") + (c.outOfRange ? " is-out-of-range" : "") + (c.visibility === "private" ? " is-private" : "")}
                    >
                      {/* Time badge */}
                      <button
                        className="fn-chapcom-time fn-mono"
                        onClick={() => !c.outOfRange && setCurrentSec(c.time)}
                        disabled={c.outOfRange}
                        title={c.outOfRange ? "動画の尺を超えています" : fmt(c.time)}
                      >
                        {fmt(c.time)}
                      </button>

                      <div className="fn-chapcom-body">
                        <div className="fn-chapcom-header">
                          <span className="fn-chapcom-label fn-jp">{c.label}</span>
                          <div className="fn-chapcom-badges">
                            {c.visibility === "private" && (
                              <span className="fn-chapcom-badge fn-chapcom-badge--private fn-mono">
                                <i className="fa-solid fa-lock"></i> 非公開
                              </span>
                            )}
                            {c.outOfRange && (
                              <span className="fn-chapcom-badge fn-chapcom-badge--oor fn-mono">
                                <i className="fa-solid fa-triangle-exclamation"></i> 範囲外
                              </span>
                            )}
                          </div>
                        </div>
                        {c.note && <p className="fn-chapcom-note fn-jp">{c.note}</p>}
                        <div className="fn-chapcom-meta">
                          <span className="fn-chapcom-avatar">{c.author.charAt(0)}</span>
                          <span className="fn-chapcom-author">{c.author}</span>
                          <span className="fn-mono fn-chapcom-handle">@{c.authorHandle}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {tab === "compose" && (
              <ChapterComposerForm
                currentSec={currentSec}
                durSec={durSec}
                fmt={fmt}
                onSubmit={(entry) => {
                  window.FN_CHAPTERS.push(entry);
                  setTab("chapterComments");
                }}
              />
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

            <div className="fn-vd-meta">
              <div className="fn-vd-meta-item">
                <h3 className="fn-eyebrow">楽曲</h3>
                <a className="fn-vd-meta-music" href="#" onClick={e => e.preventDefault()}>
                  <span>{video.music}</span>
                  <i className="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
              </div>
              <div className="fn-vd-meta-item">
                <h3 className="fn-eyebrow">紹介コメント</h3>
                <p className="fn-jp fn-vd-meta-intro">夜の導線をなぞるように、街の明滅と呼吸を重ねました。音の隙間に視線が落ちる瞬間を作りたかった一本です。</p>
              </div>
              <details className="fn-vd-details">
                <summary>詳細コメント</summary>
                <div className="fn-vd-details-body">
                  <section>
                    <h4 className="fn-vd-details-h">みどころ</h4>
                    <p className="fn-jp">47秒からのドリフト、中盤の音だけの余白区間、観測点の引きのカット。</p>
                  </section>
                  <section>
                    <h4 className="fn-vd-details-h">制作エピソード</h4>
                    <p className="fn-jp">深夜のロケハンで撮った素材をベースに、音先で構成を組み直しました。チャプター単位で2週間。</p>
                  </section>
                  <section>
                    <h4 className="fn-vd-details-h">あとがき</h4>
                    <p className="fn-jp">結節線というタイトルは、夜の動線が一点で交わる感覚から。次は昼の作品を作りたい。</p>
                  </section>
                </div>
              </details>
            </div>

            <div className="fn-vd-credits">
              <h2 className="fn-vd-section-title">参加メンバー <span className="fn-mono fn-vd-section-count">(4)</span></h2>
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
                <button className="fn-vd-pl-add" aria-label="再生リストに追加"><i className="fa-solid fa-plus"></i></button>
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

// ─── Chapter composer form ────────────────────────────────────────
function ChapterComposerForm({ currentSec, durSec, fmt, onSubmit }) {
  const [time, setTime] = _vUseState(fmt(currentSec));
  const [label, setLabel] = _vUseState("");
  const [note, setNote] = _vUseState("");
  const [isPrivate, setIsPrivate] = _vUseState(false);
  const [showOnBar, setShowOnBar] = _vUseState(true);
  const [submitted, setSubmitted] = _vUseState(false);

  const parseSec = str => {
    const parts = (str || "0:0").split(":").map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const timeSec = parseSec(time);
  const outOfRange = timeSec > durSec;
  const valid = label.trim().length > 0 && time.trim().length > 0;

  const handleSubmit = () => {
    if (!valid) return;
    onSubmit({ time: timeSec, label: label.trim(), note: note.trim() || null,
      author: "halo / loop", authorHandle: "halo_loop_v",
      visibility: isPrivate ? "private" : "public", outOfRange, showOnBar });
    setLabel(""); setNote(""); setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  };

  return (
    <div className="fn-chapcomp">
      <span className="fn-eyebrow" style={{ marginBottom: 14, display: "block" }}>チャプターコメントを追加</span>

      <label className="fn-field">
        <span className="fn-field-label">時間 <span className="fn-field-req">必須</span></span>
        <div className="fn-chapcomp-time-row">
          <input className="fn-input fn-mono" style={{ width: 88 }} placeholder="00:00" value={time} onChange={e => setTime(e.target.value)} />
          <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => setTime(fmt(currentSec))}>現在時刻 ({fmt(currentSec)})</button>
          {outOfRange && <span className="fn-chapcom-badge fn-chapcom-badge--oor fn-mono"><i className="fa-solid fa-triangle-exclamation"></i> 尺({fmt(durSec)})を超えています</span>}
        </div>
      </label>

      <label className="fn-field">
        <span className="fn-field-label">ラベル <span className="fn-field-req">必須</span></span>
        <input className="fn-input" placeholder="このチャプターのタイトル" value={label} onChange={e => setLabel(e.target.value)} maxLength={50} />
      </label>

      <label className="fn-field">
        <span className="fn-field-label">補足メモ（任意）</span>
        <textarea className="fn-input fn-chapcomp-note-ta" placeholder="みどころや補足を残せます" value={note} onChange={e => setNote(e.target.value)} maxLength={200} rows={3} />
        <span className="fn-field-hint" style={{ textAlign: "right" }}>{note.length}/200</span>
      </label>

      <div className="fn-chapcomp-toggles">
        <label className="fn-chapcomp-toggle">
          <button className={"fn-switch " + (isPrivate ? "" : "is-on")} onClick={() => setIsPrivate(v => !v)}><span className="fn-switch-knob" /></button>
          <span className="fn-jp">{isPrivate ? "非公開（自分だけ見える）" : "公開"}</span>
        </label>
        <label className="fn-chapcomp-toggle">
          <button className={"fn-switch " + (showOnBar ? "is-on" : "")} onClick={() => setShowOnBar(v => !v)}><span className="fn-switch-knob" /></button>
          <span className="fn-jp">再生バーに点として表示</span>
        </label>
      </div>

      {label && (
        <div className="fn-chapcomp-preview">
          <span className="fn-eyebrow" style={{ marginBottom: 8, display: "block" }}>プレビュー</span>
          <div className={"fn-chapcom is-preview " + (isPrivate ? "is-private" : "")}>
            <button className="fn-chapcom-time fn-mono" disabled>{time || "00:00"}</button>
            <div className="fn-chapcom-body">
              <div className="fn-chapcom-header">
                <span className="fn-chapcom-label fn-jp">{label}</span>
                <div className="fn-chapcom-badges">
                  {isPrivate && <span className="fn-chapcom-badge fn-chapcom-badge--private fn-mono"><i className="fa-solid fa-lock"></i> 非公開</span>}
                  {outOfRange && <span className="fn-chapcom-badge fn-chapcom-badge--oor fn-mono"><i className="fa-solid fa-triangle-exclamation"></i> 範囲外</span>}
                </div>
              </div>
              {note && <p className="fn-chapcom-note fn-jp">{note}</p>}
              <div className="fn-chapcom-meta">
                <span className="fn-chapcom-avatar">h</span>
                <span className="fn-chapcom-author">halo / loop</span>
                <span className="fn-mono fn-chapcom-handle">@halo_loop_v</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <button className="fn-btn" data-variant="accent" data-size="lg" style={{ width: "100%", marginTop: 8 }} disabled={!valid || submitted} onClick={handleSubmit}>
        {submitted ? <><i className="fa-solid fa-check"></i> 追加しました</> : "チャプターコメントを追加 →"}
      </button>
    </div>
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
