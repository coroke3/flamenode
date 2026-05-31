// Event detail page — header + ruler + slot table

const { useState: _eUseState } = React;

function EventDetail({ onNav, lang, forceStatus, selectedEvent }) {
  const event = window.FN_EVENTS.find(e => e.id === selectedEvent) || window.FN_EVENTS[0];
  const status = window.deriveStatus(event, forceStatus);
  const label = window.statusLabel(status.kind, lang);
  const days = window.daysUntilNext(status);
  const md = (iso) => { const [y, m, d] = iso.split("-"); return m + "/" + d; };
  const submitted = window.FN_VIDEOS.filter(v => v.event === event.id);

  const [selected, setSelected] = _eUseState({ d: 1, h: 4 });

  return (
    <main className="fn-main" data-screen-label="EventDetail">
      <div className="fn-wrap">
        {/* Header */}
        <header className="fn-ev-head">
          <div className="fn-ev-head-meta">
            <span className="fn-eyebrow">event</span>
            <h1 className="fn-display fn-ev-title">{event.title}</h1>
            <span className="fn-ev-subtitle fn-jp">{event.subtitle}</span>
            <p className="fn-ev-summary">{event.summary}</p>
          </div>
          <div className="fn-ev-head-actions">
            <span className="fn-pill" data-tone={status.kind === "entry" || status.kind === "submit" ? "accent" : "muted"}>{label}</span>
            {(status.kind === "entry" || status.kind === "submit") ? (
              <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("reserve", { event: event.id })}>{lang === "en" ? "Reserve a slot" : "枠を確保する"} →</button>
            ) : status.kind === "pre" ? (
              <button className="fn-btn" data-variant="accent" data-size="lg" disabled>{lang === "en" ? "Opens soon" : "募集開始までお待ちください"}</button>
            ) : (
              <button className="fn-btn" data-variant="ghost" data-size="lg" onClick={() => onNav("list")}>{lang === "en" ? "View archive" : "アーカイブを見る"} →</button>
            )}
            <button className="fn-btn" data-variant="ghost" data-size="sm">ガイドライン</button>
          </div>
        </header>

        {/* Stats strip */}
        <div className="fn-ev-stats">
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">entry period</span>
            <span className="fn-mono fn-ev-stat-v">{md(event.entryOpenIso)} — {md(event.entryCloseIso)}</span>
          </div>
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">submission</span>
            <span className="fn-mono fn-ev-stat-v">{md(event.submitOpenIso)} — {md(event.submitCloseIso)}</span>
          </div>
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">entries</span>
            <span className="fn-mono fn-ev-stat-v fn-display">{event.entries}</span>
          </div>
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">creators</span>
            <span className="fn-mono fn-ev-stat-v fn-display">{event.creators}</span>
          </div>
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">slots</span>
            <span className="fn-mono fn-ev-stat-v fn-display">{event.slotsAvailable}<span style={{ color: "var(--text-faint)" }}>/{event.slotsTotal}</span></span>
          </div>
          <div className="fn-ev-stat">
            <span className="fn-eyebrow">{days.label}</span>
            <span className="fn-mono fn-ev-stat-v fn-display">{Math.max(0, days.count)}<span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 4 }}>日</span></span>
          </div>
        </div>

        <div className="fn-ev-card-wrap">
          <EventRecruitmentCard event={event} lang={lang} forceStatus={forceStatus} />
        </div>

        {/* Slot table */}
        <section className="fn-ev-section">
          <div className="fn-section-head">
            <div className="fn-section-head-left">
              <div className="fn-section-titles">
                <span className="fn-eyebrow">slot table — 上映枠</span>
                <h2 className="fn-display fn-section-title">上映枠</h2>
                <span className="fn-section-jp fn-jp">空き枠を選択して確保します。確保後、投稿期間内に作品を提出してください。</span>
              </div>
            </div>
            <div className="fn-row" style={{ paddingBottom: 6, gap: 12, flexWrap: "wrap" }}>
              <Legend swatch="available" label="Available" />
              <Legend swatch="reserved"  label="Reserved" />
              <Legend swatch="submitted" label="Submitted" />
              <Legend swatch="reclaim"   label="優先再取得中" />
            </div>
          </div>

          <SlotTable selected={selected} setSelected={setSelected} onOpen={() => onNav("video")} />
          <SelectionPanel selected={selected} onNav={onNav} />
        </section>

        {/* Crew */}
        <section className="fn-ev-section">
          <div className="fn-section-head">
            <div className="fn-section-head-left">
              <div className="fn-section-titles">
                <span className="fn-eyebrow">crew — 運営メンバー</span>
                <h2 className="fn-display fn-section-title">Crew</h2>
              </div>
            </div>
          </div>
          <table className="fn-ev-crew">
            <thead>
              <tr>
                <th>Role</th><th>Name</th><th>X / @</th><th>Scope</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Representative</td><td>halo / loop</td><td className="fn-mono">@halo_loop_v</td><td className="fn-ev-crew-scope">event · slots · members</td></tr>
              <tr><td>Editor</td><td>frame index</td><td className="fn-mono">@frame_index__</td><td className="fn-ev-crew-scope">videos · review</td></tr>
              <tr><td>Editor</td><td>凜・大塚</td><td className="fn-mono">@rin_otsuka_</td><td className="fn-ev-crew-scope">event · questions</td></tr>
              <tr><td>Collaborator</td><td>ことりのす</td><td className="fn-mono">@kotorinosu_mv</td><td className="fn-ev-crew-scope">music credit</td></tr>
            </tbody>
          </table>
        </section>

        {/* Submitted videos */}
        <section className="fn-ev-section">
          <div className="fn-section-head">
            <div className="fn-section-head-left">
              <div className="fn-section-titles">
                <span className="fn-eyebrow">submitted — 提出済み</span>
                <h2 className="fn-display fn-section-title">Submitted videos</h2>
                <span className="fn-section-jp fn-jp">受付中の提出済み作品（{event.entries}件）</span>
              </div>
            </div>
            <button className="fn-section-more" onClick={() => onNav("list")}>すべて見る <span>→</span></button>
          </div>
          {submitted.length > 0 ? (
            <div className="fn-list-grid">
              {submitted.map((v) => (
                <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
              ))}
            </div>
          ) : (
            <p className="fn-jp" style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>
              このイベントの提出済み作品はまだ表示できません。
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="fn-legend">
      <span className="fn-legend-swatch" data-kind={swatch} />
      <span className="fn-legend-label">{label}</span>
    </span>
  );
}

function SlotTable({ selected, setSelected, onOpen }) {
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;
  const statusText = { available: "空き", reserved: "確保済", submitted: "提出済", reclaim: "再取得中" };
  return (
    <div className="fn-slot-wrap">
      <table className="fn-slot">
        <thead>
          <tr>
            <th className="fn-slot-corner"></th>
            {days.map((d, i) => <th key={i} className="fn-slot-dayhead"><span className="fn-mono">{d}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {hours.map((h, hi) => (
            <tr key={h}>
              <th className="fn-slot-hourhead"><span className="fn-mono">{h}</span></th>
              {days.map((_, di) => {
                const cell = matrix[di][hi];
                const isSel = selected.d === di && selected.h === hi;
                return (
                  <td
                    key={di}
                    className={"fn-slot-cell " + (isSel ? "is-selected" : "")}
                    data-status={cell.status}
                    onClick={() => {
                      if (cell.status === "available") setSelected({ d: di, h: hi });
                      else if (cell.status === "submitted") onOpen();
                    }}
                  >
                    <div className="fn-slot-cell-inner">
                      <span className="fn-slot-cell-name">
                        {cell.name ?? (cell.status === "available" ? "空き枠" : cell.status === "reclaim" ? "再取得中" : "—")}
                      </span>
                      <span className="fn-slot-cell-status">{statusText[cell.status]}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectionPanel({ selected, onNav }) {
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;
  const cell = matrix[selected.d][selected.h];
  return (
    <div className="fn-slot-panel">
      <div className="fn-slot-panel-left">
        <span className="fn-eyebrow">selection</span>
        <div className="fn-slot-panel-row">
          <span className="fn-mono fn-slot-panel-day">{days[selected.d]}</span>
          <span className="fn-mono fn-slot-panel-hour">{hours[selected.h]}</span>
          <span className="fn-pill" data-tone={cell.status === "available" ? "ok" : "muted"}>{cell.status === "available" ? "空き" : cell.status}</span>
        </div>
        <span className="fn-slot-panel-name fn-jp">{cell.name ?? "この枠は空いています"}</span>
      </div>
      <div className="fn-slot-panel-right">
        <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("reserve")}>枠表をすべて見る</button>
        <button className="fn-btn" data-variant="accent" data-size="lg" disabled={cell.status !== "available"} onClick={() => onNav("reserve")}>
          {cell.status === "available" ? "この枠を確保する →" : "確保不可"}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { EventDetail });
