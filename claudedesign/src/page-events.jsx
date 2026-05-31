// Events list page — 募集中 / 開催予定 / 開催済み / アーカイブ

function categorize(ev) {
  const s = window.deriveStatus(ev, "auto");
  if (ev.id === "archive") return "archive";
  if (s.kind === "ended") return "ended";
  if (s.kind === "pre") return "upcoming";
  return "open"; // entry / submit
}

function EventCard({ event, lang, onOpen, compact }) {
  const status = window.deriveStatus(event, "auto");
  const label = window.statusLabel(status.kind, lang);
  const days = window.daysUntilNext(status);
  const cat = categorize(event);
  const tone = (status.kind === "entry" || status.kind === "submit") ? "accent" : status.kind === "ended" ? "muted" : "muted";
  return (
    <article className={"fn-evcard " + (compact ? "is-compact" : "")} data-kind={status.kind} onClick={onOpen}>
      <div className="fn-evcard-poster" style={{ "--ev-accent": event.accent }}>
        <div className="fn-evcard-poster-grid" aria-hidden="true" />
        <span className="fn-evcard-code fn-mono">{event.code}</span>
        {cat === "ended" && <span className="fn-evcard-ribbon fn-mono">上映終了</span>}
        {cat === "archive" && <span className="fn-evcard-ribbon fn-mono">常時受付</span>}
      </div>
      <div className="fn-evcard-body">
        <div className="fn-evcard-top">
          <span className="fn-pill" data-tone={tone}>{label}</span>
          <span className="fn-mono fn-evcard-range">{event.rangeText}</span>
        </div>
        <h3 className="fn-display fn-evcard-title">{event.title}</h3>
        <p className="fn-evcard-summary">{event.summary}</p>
        <div className="fn-evcard-foot fn-mono">
          <span>{event.entries} 作品</span>
          <span className="fn-evcard-sep" />
          <span>{event.creators} 名</span>
          {cat === "open" && <><span className="fn-evcard-sep" /><span className="fn-evcard-days">{Math.max(0, days.count)} 日</span></>}
        </div>
      </div>
    </article>
  );
}

function EventsPage({ onNav, lang }) {
  const events = window.FN_EVENTS;
  const open = events.filter(e => categorize(e) === "open");
  const upcoming = events.filter(e => categorize(e) === "upcoming");
  const ended = events.filter(e => categorize(e) === "ended");
  const archive = events.filter(e => categorize(e) === "archive");

  const Section = ({ title, jp, items }) => items.length === 0 ? null : (
    <section className="fn-evlist-section">
      <div className="fn-section-head">
        <div className="fn-section-head-left">
          <div className="fn-section-titles">
            <h2 className="fn-display fn-section-title">{title}</h2>
            <span className="fn-section-jp fn-jp">{jp}</span>
          </div>
        </div>
        <span className="fn-mono fn-evlist-count">{String(items.length).padStart(2, "0")}</span>
      </div>
      <div className="fn-evlist-grid">
        {items.map(ev => <EventCard key={ev.id} event={ev} lang={lang} onOpen={() => onNav("event", { event: ev.id })} />)}
      </div>
    </section>
  );

  return (
    <main className="fn-main" data-screen-label="Events">
      <div className="fn-wrap">
        <header className="fn-evlist-head">
          <h1 className="fn-display fn-evlist-title">イベント</h1>
          <span className="fn-jp fn-evlist-sub">FlameNode 上で開催される上映フェス・イベントの一覧。</span>
        </header>

        <Section title="募集中" jp="Open for entry" items={open} />
        <Section title="開催予定" jp="Upcoming" items={upcoming} />
        <Section title="開催済み" jp="Past events" items={ended} />
        <Section title="アーカイブ" jp="Always-on archive" items={archive} />
      </div>
    </main>
  );
}

Object.assign(window, { EventsPage, EventCard, categorizeEvent: categorize });
