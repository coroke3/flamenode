// FlameNode — Event Recruitment Card (refined)
// The hero component. Status-aware. Light/dark + 3 variation aware.

const { useMemo } = React;

// ─── Date utilities ────────────────────────────────────────────────
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}
function fmtMonthDay(d) {
  return (d.getMonth() + 1) + "/" + d.getDate();
}
function fmtMonthDayShort(d) {
  return (d.getMonth() + 1) + "/" + String(d.getDate()).padStart(2, "0");
}

// ─── Derive status ─────────────────────────────────────────────────
function deriveStatus(event, forceStatus) {
  const today = parseIso(event.todayIso);
  const entryOpen = parseIso(event.entryOpenIso);
  const entryClose = parseIso(event.entryCloseIso);
  const submitOpen = parseIso(event.submitOpenIso);
  const submitClose = parseIso(event.submitCloseIso);
  let kind;
  if (forceStatus && forceStatus !== "auto") {
    kind = forceStatus;
  } else if (today < entryOpen) kind = "pre";
  else if (today <= entryClose) kind = "entry";
  else if (today <= submitClose) kind = "submit";
  else kind = "ended";
  return { kind, today, entryOpen, entryClose, submitOpen, submitClose };
}

// Status label dictionary (JP + EN bilingual)
function statusLabel(kind, lang) {
  const dict = {
    pre:    { ja: "開幕前",       en: "Pre-open" },
    entry:  { ja: "募集期間中",   en: "Entry open" },
    submit: { ja: "投稿期間中",   en: "Submission" },
    ended:  { ja: "終了",         en: "Ended" },
  };
  const e = dict[kind];
  if (lang === "bilingual") return e.ja + " / " + e.en;
  if (lang === "en") return e.en;
  return e.ja;
}

// Days remaining until next milestone
function daysUntilNext(status) {
  const { kind, today, entryOpen, entryClose, submitOpen, submitClose } = status;
  if (kind === "pre")    return { count: daysBetween(today, entryOpen),  label: "募集開始まで", labelEn: "ENTRY OPENS IN" };
  if (kind === "entry")  return { count: daysBetween(today, submitOpen), label: "投稿期間まで", labelEn: "SUBMISSION IN" };
  if (kind === "submit") return { count: daysBetween(today, submitClose),label: "投稿締切まで", labelEn: "DEADLINE IN" };
  return { count: 0, label: "終了", labelEn: "ENDED" };
}

// ─── Ruler component ───────────────────────────────────────────────
// Renders a timeline ruler from `start` to `end` with:
//  • month boundary marks
//  • day ticks (every day, longer every 5)
//  • today marker
//  • highlighted submission window
function Ruler({ status, event, lang, height = 60 }) {
  // Window: start = day before entryOpen, end = day after submitClose
  const start = new Date(status.entryOpen);
  start.setDate(start.getDate() - 4);
  const end = new Date(status.submitClose);
  end.setDate(end.getDate() + 2);
  const total = daysBetween(start, end);

  const pct = (d) => (daysBetween(start, d) / total) * 100;

  // Generate per-day ticks
  const ticks = useMemo(() => {
    const list = [];
    for (let i = 0; i <= total; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const isMonthFirst = d.getDate() === 1;
      const isWeekly = i % 5 === 0;
      list.push({
        x: (i / total) * 100,
        major: isMonthFirst,
        weekly: isWeekly,
        date: new Date(d),
      });
    }
    return list;
  }, [event.id]);

  // Month labels (placed at first of each month inside window)
  const monthLabels = ticks.filter(t => t.major).map(t => ({
    x: t.x,
    label: (t.date.getMonth() + 1) + "月",
  }));
  // Also show the start month even if no boundary inside
  if (monthLabels.length === 0 || monthLabels[0].x > 4) {
    monthLabels.unshift({ x: 0, label: (start.getMonth() + 1) + "月" });
  }

  const todayX = Math.min(100, Math.max(0, pct(status.today)));
  const subStartX = pct(status.submitOpen);
  const subEndX = pct(status.submitClose);
  const entryStartX = pct(status.entryOpen);
  const entryEndX = pct(status.entryClose);

  return (
    <div className="fn-ruler" style={{ height }}>
      {/* Submission window highlight */}
      <div
        className="fn-ruler-window"
        data-kind="submit"
        style={{ left: subStartX + "%", width: (subEndX - subStartX) + "%" }}
        aria-hidden="true"
      />
      {/* Entry window highlight */}
      <div
        className="fn-ruler-window"
        data-kind="entry"
        style={{ left: entryStartX + "%", width: (entryEndX - entryStartX) + "%" }}
        aria-hidden="true"
      />

      {/* Tick marks */}
      <div className="fn-ruler-ticks">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="fn-ruler-tick"
            data-major={t.major ? "" : null}
            data-weekly={t.weekly && !t.major ? "" : null}
            style={{ left: t.x + "%" }}
          />
        ))}
      </div>

      {/* Month labels */}
      <div className="fn-ruler-labels">
        {monthLabels.map((m, i) => (
          <span key={i} className="fn-ruler-label fn-mono" style={{ left: m.x + "%" }}>
            {m.label}
          </span>
        ))}
        {/* Today label */}
        <span
          className="fn-ruler-label fn-mono"
          data-today=""
          style={{ left: todayX + "%" }}
        >
          {fmtMonthDay(status.today)}
        </span>
      </div>

      {/* Today marker */}
      <div className="fn-ruler-today" style={{ left: todayX + "%" }} aria-hidden="true">
        <span className="fn-ruler-today-bar" />
      </div>

      {/* End arrow */}
      <span className="fn-ruler-arrow" aria-hidden="true" />
    </div>
  );
}

// ─── Right info block ──────────────────────────────────────────────
function InfoBlock({ status, event, lang }) {
  const next = daysUntilNext(status);
  const lbl = lang === "bilingual"
    ? next.label
    : (lang === "en" ? next.labelEn : next.label);

  const periodLabel = status.kind === "submit" || status.kind === "entry"
    ? (lang === "bilingual" ? "投稿期間 / Submission" : lang === "en" ? "Submission" : "投稿期間")
    : status.kind === "pre"
      ? (lang === "bilingual" ? "募集開始 / Entry open" : lang === "en" ? "Entry open" : "募集開始")
      : (lang === "bilingual" ? "終了 / Closed" : lang === "en" ? "Closed" : "終了");

  const rangeText = status.kind === "submit" || status.kind === "entry"
    ? (fmtMonthDayShort(status.submitOpen) + " — " + fmtMonthDayShort(status.submitClose))
    : status.kind === "pre"
      ? (fmtMonthDayShort(status.entryOpen) + " — " + fmtMonthDayShort(status.entryClose))
      : fmtMonthDayShort(status.submitClose);

  return (
    <div className="fn-rec-info" data-kind={status.kind}>
      <div className="fn-rec-info-head">
        <span className="fn-rec-info-label">{periodLabel}</span>
        <span className="fn-rec-info-range fn-mono">{rangeText}</span>
      </div>
      <div className="fn-rec-info-count">
        <span className="fn-rec-info-num fn-display">{Math.max(0, next.count)}</span>
        <span className="fn-rec-info-tail">
          <span className="fn-rec-info-unit">日</span>
          <span className="fn-rec-info-prefix">{lbl}</span>
        </span>
      </div>
    </div>
  );
}

// ─── Main card ─────────────────────────────────────────────────────
function EventRecruitmentCard({ event, lang = "ja", forceStatus = "auto", onOpen }) {
  const status = useMemo(() => deriveStatus(event, forceStatus), [event.id, forceStatus]);
  const label = statusLabel(status.kind, lang);
  const ctaLabel = lang === "bilingual"
    ? "詳細ページへ / OPEN"
    : lang === "en"
      ? "OPEN DETAILS"
      : "詳細ページへ";

  return (
    <article className="fn-rec" data-kind={status.kind} aria-label={event.code + " " + label}>
      <header className="fn-rec-head">
        <div className="fn-rec-title-row">
          <span className="fn-rec-code fn-mono">{event.code}</span>
          <span className="fn-rec-status fn-display">{label}</span>
        </div>
        <button className="fn-btn fn-rec-cta" data-variant="accent" data-size="lg" onClick={onOpen}>
          <span>{ctaLabel}</span>
          <span className="fn-rec-cta-arrow" aria-hidden="true">→</span>
        </button>
      </header>

      <div className="fn-rec-body">
        <Ruler status={status} event={event} lang={lang} />
        <InfoBlock status={status} event={event} lang={lang} />
      </div>

      <footer className="fn-rec-foot">
        <span className="fn-rec-foot-cell fn-mono">
          <span className="fn-rec-foot-k">entries</span>
          <span className="fn-rec-foot-v">{event.entries}</span>
        </span>
        <span className="fn-rec-foot-cell fn-mono">
          <span className="fn-rec-foot-k">creators</span>
          <span className="fn-rec-foot-v">{event.creators}</span>
        </span>
        <span className="fn-rec-foot-cell fn-mono">
          <span className="fn-rec-foot-k">slots left</span>
          <span className="fn-rec-foot-v">{event.slotsAvailable}<span className="fn-rec-foot-tot">/{event.slotsTotal}</span></span>
        </span>
        <span className="fn-rec-foot-cell fn-rec-foot-cell--wide">
          <span className="fn-rec-foot-k">event</span>
          <span className="fn-rec-foot-v fn-rec-foot-v--text">{event.subtitle}</span>
        </span>
      </footer>
    </article>
  );
}

Object.assign(window, { EventRecruitmentCard, deriveStatus, statusLabel, daysUntilNext, fmtMonthDay });
