/**
 * Event display state helpers shared by public UI and admin views.
 *
 * DB上の公開設定は private / public の2種類だけを正本とし、
 * 開催段階と募集段階は日時から算出する。
 */
/** 未知値・legacy draft/archived は fail-closed で private。archived を public にしない。 */
export function normalizeEventVisibility(raw) {
    return raw === "public" ? "public" : "private";
}
export function getEventVisibility(ev) {
    return normalizeEventVisibility(ev.visibility_status);
}
export function isPublicEventVisible(ev) {
    return getEventVisibility(ev) === "public";
}
export function getEffectiveEventEnd(ev) {
    return ev.end_time ?? null;
}
export function getEffectiveEventStart(ev) {
    return ev.start_time ?? null;
}
/** 開催期間が片方だけ設定されたシリーズ企画（点イベント）。 */
export function isPointEvent(ev) {
    return (ev.start_time != null) !== (ev.end_time != null);
}
export function computeEventStatus(ev, now = Math.floor(Date.now() / 1000)) {
    if (getEventVisibility(ev) !== "public")
        return "private";
    if (isPointEvent(ev))
        return "published";
    const effectiveEnd = getEffectiveEventEnd(ev);
    if (effectiveEnd != null && effectiveEnd <= now)
        return "ended";
    const effectiveStart = getEffectiveEventStart(ev);
    if (effectiveStart != null && effectiveStart > now)
        return "scheduled";
    if (effectiveStart != null || effectiveEnd != null)
        return "active";
    return "published";
}
export function eventStatusLabel(s) {
    switch (s) {
        case "private": return "非公開";
        case "published": return "公開";
        case "scheduled": return "開始前";
        case "active": return "開催中";
        case "ended": return "終了済";
    }
}
export function eventStatusBadgeClass(s) {
    switch (s) {
        case "active":
        case "published": return "fn-badge-accent";
        case "scheduled": return "fn-badge-warning";
        case "ended": return "fn-badge-neutral";
        case "private": return "fn-badge-soft";
    }
}
export function isAcceptingEntries(ev, now = Math.floor(Date.now() / 1000)) {
    const status = computeEventStatus(ev, now);
    if (status === "private" || status === "ended")
        return false;
    if (ev.entry_start_time == null && ev.entry_end_time == null)
        return false;
    if (ev.entry_start_time != null && now < ev.entry_start_time)
        return false;
    if (ev.entry_end_time != null && now >= ev.entry_end_time)
        return false;
    return true;
}
