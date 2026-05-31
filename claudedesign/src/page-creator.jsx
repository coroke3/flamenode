// Creator list page — dense multi-column grid

const { useState: _crUseState } = React;

function CreatorList({ onNav }) {
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS;
  const [sort, setSort] = _crUseState("featured");
  const [view, setView] = _crUseState("grid"); // grid | index

  const sorted = creators.slice();
  if (sort === "alpha") sorted.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "videos") sorted.sort((a, b) => b.videos - a.videos);

  const topVideo = {};
  creators.forEach(c => {
    const list = videos.filter(v => v.creator === c.id).sort((a, b) => b.score - a.score);
    topVideo[c.id] = list[0] ?? videos[0];
  });

  // Repeat creators for visual density
  const display = [...sorted, ...sorted, ...sorted.slice(0, 8)];

  return (
    <main className="fn-main" data-screen-label="Creators">
      <div className="fn-wrap">
        <header className="fn-cr-head">
          <div>
            <span className="fn-eyebrow">creators — 412 artists</span>
            <h1 className="fn-display fn-cr-title">Creators</h1>
            <span className="fn-jp fn-cr-sub">作家インデックス。投稿数・参加イベント数で検索/並び替え。</span>
          </div>
          <div className="fn-cr-controls">
            <div className="fn-cr-segment">
              {[
                { id: "featured", label: "Featured" },
                { id: "videos",   label: "Most works" },
                { id: "alpha",    label: "A — Z" },
              ].map(o => (
                <button key={o.id} className={"fn-cr-seg-btn " + (sort === o.id ? "is-active" : "")} onClick={() => setSort(o.id)}>
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <div className="fn-cr-segment">
              <button className={"fn-cr-seg-btn " + (view === "grid" ? "is-active" : "")} onClick={() => setView("grid")}><span>Tile</span></button>
              <button className={"fn-cr-seg-btn " + (view === "index" ? "is-active" : "")} onClick={() => setView("index")}><span>Index</span></button>
            </div>
            <input className="fn-cr-input fn-mono" placeholder="search creators / 名前で検索" />
          </div>
        </header>

        {view === "grid" ? (
          <div className="fn-cr-grid">
            {display.map((c, i) => (
              <article key={c.id + "-" + i} className="fn-cr-tile" onClick={() => onNav("video", { video: topVideo[c.id]?.id })}>
                <div className="fn-cr-tile-avatar">{c.name.charAt(0)}</div>
                <div className="fn-cr-tile-body">
                  <h3 className="fn-cr-tile-name">{c.name}</h3>
                  <span className="fn-mono fn-cr-tile-handle">@{c.handle}</span>
                  <div className="fn-cr-tile-stats fn-mono">
                    <span>{c.videos} works</span>
                    <span className="fn-cr-tile-sep" />
                    <span>{((i * 3) % 6) + 1} events</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <table className="fn-cr-tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>X / @</th>
                <th>Works</th>
                <th>Events</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              {display.map((c, i) => (
                <tr key={c.id + "-" + i} onClick={() => onNav("video", { video: topVideo[c.id]?.id })}>
                  <td>
                    <div className="fn-cr-tbl-name">
                      <span className="fn-cr-tbl-avatar">{c.name.charAt(0)}</span>
                      <span>{c.name}</span>
                    </div>
                  </td>
                  <td className="fn-mono">@{c.handle}</td>
                  <td className="fn-mono">{c.videos}</td>
                  <td className="fn-mono">{((i * 3) % 6) + 1}</td>
                  <td>{topVideo[c.id]?.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { CreatorList });
