// Dedicated slot reservation page — 枠確保

const { useState: _rvUseState } = React;

function ReservePage({ onNav, lang, selectedEvent }) {
  const sel = window.FN_EVENTS.find(e => e.id === selectedEvent);
  const event = (sel && ["entry", "submit"].includes(window.deriveStatus(sel, "auto").kind)) ? sel : window.FN_EVENTS[0];
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;
  const [picked, setPicked] = _rvUseState({ d: 1, h: 4 });
  const [dayFilter, setDayFilter] = _rvUseState("all");
  const [confirm, setConfirm] = _rvUseState(false);

  const cell = matrix[picked.d][picked.h];
  const free = cell.status === "available";

  // counts
  let avail = 0, total = 0;
  matrix.forEach(row => row.forEach(c => { total++; if (c.status === "available") avail++; }));

  return (
    <main className="fn-main" data-screen-label="Reserve">
      <div className="fn-wrap fn-rv">
        {/* Breadcrumb */}
        <div className="fn-rv-crumb fn-mono">
          <button onClick={() => onNav("events")}>イベント</button><span>›</span>
          <button onClick={() => onNav("event", { event: event.id })}>{event.code}</button><span>›</span>
          <span style={{ color: "var(--text-primary)" }}>枠を確保</span>
        </div>

        <header className="fn-rv-head">
          <div>
            <h1 className="fn-display fn-rv-title">枠を確保</h1>
            <span className="fn-jp fn-rv-sub">{event.title} — 上映スロットを選んで確保します。</span>
          </div>
          <div className="fn-rv-availbox">
            <span className="fn-display fn-rv-availnum">{avail}<span className="fn-rv-availtot">/{total}</span></span>
            <span className="fn-jp fn-rv-availk">空き枠</span>
          </div>
        </header>

        <div className="fn-rv-grid">
          {/* Slot picker */}
          <div className="fn-rv-main">
            <div className="fn-rv-toolbar">
              <div className="fn-cr-segment">
                <button className={"fn-cr-seg-btn " + (dayFilter === "all" ? "is-active" : "")} onClick={() => setDayFilter("all")}><span>全日程</span></button>
                {days.map((d, i) => (
                  <button key={i} className={"fn-cr-seg-btn " + (dayFilter === String(i) ? "is-active" : "")} onClick={() => setDayFilter(String(i))}><span>{d.split(" ")[0]}</span></button>
                ))}
              </div>
              <div className="fn-row" style={{ gap: 14, flexWrap: "wrap" }}>
                <span className="fn-legend"><span className="fn-legend-swatch" data-kind="available" /><span className="fn-legend-label">空き</span></span>
                <span className="fn-legend"><span className="fn-legend-swatch" data-kind="submitted" /><span className="fn-legend-label">確保済</span></span>
                <span className="fn-legend"><span className="fn-legend-swatch" data-kind="reclaim" /><span className="fn-legend-label">優先再取得中</span></span>
              </div>
            </div>

            <div className="fn-slot-wrap">
              <table className="fn-slot">
                <thead>
                  <tr>
                    <th className="fn-slot-corner"></th>
                    {days.map((d, i) => (dayFilter === "all" || dayFilter === String(i)) && <th key={i} className="fn-slot-dayhead"><span className="fn-mono">{d}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h, hi) => (
                    <tr key={h}>
                      <th className="fn-slot-hourhead"><span className="fn-mono">{h}</span></th>
                      {days.map((_, di) => {
                        if (!(dayFilter === "all" || dayFilter === String(di))) return null;
                        const c = matrix[di][hi];
                        const isSel = picked.d === di && picked.h === hi;
                        const isFree = c.status === "available";
                        return (
                          <td key={di} className={"fn-slot-cell " + (isSel ? "is-selected" : "")} data-status={c.status} onClick={() => isFree && setPicked({ d: di, h: hi })}>
                            <div className="fn-slot-cell-inner">
                              <span className="fn-slot-cell-name">{c.name ?? (isFree ? "空き枠" : c.status === "reclaim" ? "再取得中" : "—")}</span>
                              <span className="fn-slot-cell-status">{isFree ? "選択可" : c.status === "reclaim" ? "ロック" : "確保済"}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sticky summary */}
          <aside className="fn-rv-side">
            <div className="fn-rv-card">
              <span className="fn-eyebrow">選択中の枠</span>
              <div className="fn-rv-pick">
                <span className="fn-display fn-rv-pick-hour">{hours[picked.h]}</span>
                <span className="fn-mono fn-rv-pick-day">{days[picked.d]}</span>
              </div>
              <span className={"fn-pill " + ""} data-tone={free ? "ok" : "muted"}>{free ? "確保できます" : "この枠は確保できません"}</span>

              <dl className="fn-rv-detail">
                <div><dt className="fn-jp">イベント</dt><dd>{event.title}</dd></div>
                <div><dt className="fn-jp">形式</dt><dd>単枠 / 上映3分以内</dd></div>
                <div><dt className="fn-jp">提出締切</dt><dd className="fn-mono">08/31 23:59</dd></div>
                <div><dt className="fn-jp">保存名義</dt><dd>halo / loop</dd></div>
              </dl>

              <button className="fn-btn" data-variant="accent" data-size="lg" disabled={!free} onClick={() => setConfirm(true)} style={{ width: "100%" }}>
                {free ? "この枠を確保する →" : "別の枠を選択"}
              </button>
              <p className="fn-rv-note fn-jp">確保後、投稿期間内に作品を提出してください。未提出の枠は自動解放されます。</p>
            </div>
          </aside>
        </div>
      </div>

      {confirm && (
        <div className="fn-modal-scrim" onClick={() => setConfirm(false)}>
          <div className="fn-modal" onClick={e => e.stopPropagation()}>
            <span className="fn-eyebrow">枠確保の確認</span>
            <h2 className="fn-display fn-modal-title">この枠を確保しますか？</h2>
            <div className="fn-rv-confirm-slot">
              <span className="fn-display fn-rv-pick-hour" style={{ fontSize: 34 }}>{hours[picked.h]}</span>
              <div>
                <span className="fn-mono" style={{ display: "block", fontSize: 13 }}>{days[picked.d]}</span>
                <span className="fn-jp" style={{ fontSize: 12, color: "var(--text-muted)" }}>{event.title}</span>
              </div>
            </div>
            <p className="fn-modal-text fn-jp">確保すると、この枠は <strong>あなたの確保済み枠</strong> になります。続けて作品情報を入力できます。</p>
            <div className="fn-modal-actions">
              <button className="fn-btn" data-variant="ghost" onClick={() => setConfirm(false)}>キャンセル</button>
              <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => { setConfirm(false); onNav("submit"); }}>確保して投稿へ →</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

Object.assign(window, { ReservePage });
