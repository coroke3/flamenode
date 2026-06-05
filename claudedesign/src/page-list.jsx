// List page — full video archive

const { useState: _lsUseState } = React;

function ListPage({ onNav }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const [view, setView] = _lsUseState("grid"); // grid | index
  const [filter, setFilter] = _lsUseState("all");

  let list = videos.slice();
  if (filter !== "all") list = list.filter(v => v.event === filter);

  return (
    <main className="fn-main" data-screen-label="List">
      <div className="fn-wrap">
        <header className="fn-cr-head">
          <div>
            <span className="fn-eyebrow">archive — {videos.length} works</span>
            <h1 className="fn-display fn-cr-title">作品一覧</h1>
            <span className="fn-jp fn-cr-sub">作品インデックス</span>
          </div>
          <div className="fn-cr-controls">
            <div className="fn-cr-segment">
              {[
                { id: "all", label: "All" },
                { id: "pvsf2025s", label: "PVSF2025S" },
                { id: "ncnc", label: "NCNC" },
                { id: "archive", label: "Archive" },
              ].map(o => (
                <button key={o.id} className={"fn-cr-seg-btn " + (filter === o.id ? "is-active" : "")} onClick={() => setFilter(o.id)}>
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <div className="fn-cr-segment">
              <button className={"fn-cr-seg-btn " + (view === "grid" ? "is-active" : "")} onClick={() => setView("grid")}><span>Tile</span></button>
              <button className={"fn-cr-seg-btn " + (view === "index" ? "is-active" : "")} onClick={() => setView("index")}><span>Index</span></button>
            </div>
          </div>
        </header>

        {view === "grid" ? (
          <div className="fn-list-grid">
            {list.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
            ))}
          </div>
        ) : (
          <table className="fn-list-tbl">
            <thead>
              <tr>
                <th>Code</th><th>Title</th><th>Creator</th><th>Event</th><th>Music</th><th>Dur</th><th>Score</th><th>Posted</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const c = creators.find(c => c.id === v.creator);
                return (
                  <tr key={v.id} onClick={() => onNav("video", { video: v.id })}>
                    <td className="fn-mono">{v.code}</td>
                    <td>{v.title}</td>
                    <td>{c.name}</td>
                    <td className="fn-mono">{v.event}</td>
                    <td>{v.music}</td>
                    <td className="fn-mono">{v.duration}</td>
                    <td className="fn-mono">{v.score.toLocaleString()}</td>
                    <td className="fn-mono">{v.posted}</td>
                    <td>→</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { ListPage });
