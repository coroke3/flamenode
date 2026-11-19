/**
 * MIG-0728 U01: CURRENT EventGroupMembersEditor (SA-025 / SA-029 / SA-030)
 * preserving stale-search discard (searchRequestRef), cursor dedup, and
 * single-flight mutation locks.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import {
  createAdminEventGroupsApi,
  type AdminEventGroupsApi,
} from "../../api/adminEventGroups.js";
import { formatEventUnix } from "../../api/adminEvents.js";

export interface EventGroupMemberRow {
  event_id: string;
  title: string;
  start_time: number | null;
}

export interface EventOption {
  id: string;
  title: string;
  start_time?: number | null;
}

export function EventGroupMembersEditor({
  groupId,
  members,
  eventOptions,
  initialEventOptionsCursor = null,
  api,
  onChanged,
}: {
  groupId: string;
  members: EventGroupMemberRow[];
  eventOptions: EventOption[];
  initialEventOptionsCursor?: string | null;
  api?: AdminEventGroupsApi;
  onChanged?: () => void;
}): React.ReactElement {
  const client = React.useMemo(() => api ?? createAdminEventGroupsApi(), [api]);
  const [busy, setBusy] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [search, setSearch] = React.useState("");
  const [loadedOptions, setLoadedOptions] = React.useState<EventOption[]>(eventOptions);
  const [nextCursor, setNextCursor] = React.useState<string | null>(
    initialEventOptionsCursor,
  );
  const searchRequestRef = React.useRef(0);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const loadedQueryRef = React.useRef("");
  const hasCustomOptionsRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasCustomOptionsRef.current) {
      setLoadedOptions(eventOptions);
      setNextCursor(initialEventOptionsCursor);
    }
  }, [eventOptions, initialEventOptionsCursor]);

  React.useEffect(() => () => {
    searchAbortRef.current?.abort();
  }, []);

  const memberIds = new Set(members.map((m) => m.event_id));
  const availableEvents = loadedOptions.filter((e) => !memberIds.has(e.id));

  async function runEventSearch(cursor: string | null): Promise<void> {
    const requestId = ++searchRequestRef.current;
    const requestedQuery = cursor ? loadedQueryRef.current : search;
    if (!cursor) loadedQueryRef.current = search;
    hasCustomOptionsRef.current = true;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    try {
      const result = await client.searchEventOptions(
        { groupId, query: requestedQuery, cursor },
        controller.signal,
      );
      if (requestId !== searchRequestRef.current) return;
      if (!result.ok) {
        if ("anonymous" in result && result.anonymous) {
          window.location.assign("/entry");
          return;
        }
        if (!("aborted" in result && result.aborted)) {
          setError(result.message);
        }
        return;
      }
      setLoadedOptions((current) =>
        cursor
          ? [
              ...current,
              ...result.options.filter(
                (option) => !current.some((item) => item.id === option.id),
              ),
            ]
          : result.options,
      );
      setNextCursor(result.nextCursor);
    } catch {
      if (requestId !== searchRequestRef.current) return;
      setError("イベント候補の取得に失敗しました。もう一度お試しください。");
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
      }
    }
  }

  function onSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setMessage(null);
    void runEventSearch(null);
  }

  function toggleSelected(eventId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  async function onAddSelected(): Promise<void> {
    if (busyRef.current || selectedIds.size === 0) return;
    const chosen = [...selectedIds];
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await client.addEvents({ groupId, eventIds: chosen });
      if (r.anonymous) {
        window.location.assign("/entry");
        return;
      }
      if (!r.ok) {
        setError(r.message ?? "追加に失敗しました。");
        return;
      }
      setSelectedIds(new Set());
      setMessage(`${r.added ?? chosen.length} 件を追加しました。`);
      onChanged?.();
    } catch {
      setError("追加に失敗しました。もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onRemove(eventId: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await client.removeEvent({ groupId, eventId });
      if (r.anonymous) {
        window.location.assign("/entry");
        return;
      }
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      onChanged?.();
    } catch {
      setError("削除に失敗しました。もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {availableEvents.length > 0 || nextCursor || search || hasCustomOptionsRef.current ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <form
            onSubmit={onSearch}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              maxLength={64}
              placeholder="イベント名で検索"
              aria-label="イベント名で検索"
              className="fn-input"
              style={{ flex: 1, minWidth: 0 }}
              disabled={busy}
            />
            <button
              type="submit"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={busy}
            >
              検索
            </button>
          </form>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span className="fn-label" style={{ margin: 0 }}>
              イベントを選択して追加
            </span>
            <button
              type="button"
              className="fn-btn fn-btn-primary fn-btn-sm"
              onClick={() => void onAddSelected()}
              disabled={busy || selectedIds.size === 0}
            >
              {selectedIds.size > 0
                ? `${selectedIds.size} 件を追加`
                : "選択を追加"}
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 280,
              overflowY: "auto",
              padding: "8px 10px",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {availableEvents.length === 0 ? (
              <p className="fn-muted" style={{ fontSize: 13, margin: 0 }}>
                {searching ? "検索中…" : "該当するイベント候補はありません。"}
              </p>
            ) : (
              availableEvents.map((e) => (
                <label
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 4px",
                    fontSize: 13,
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(e.id)}
                    onChange={() => toggleSelected(e.id)}
                    disabled={busy}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{e.title}</span>
                    {e.start_time != null ? (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--text-muted)",
                        }}
                      >
                        {formatEventUnix(e.start_time, true)}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))
            )}
          </div>
          {nextCursor ? (
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={() => void runEventSearch(nextCursor)}
              disabled={busy}
            >
              さらに読み込む
            </button>
          ) : null}
        </div>
      ) : (
        <p className="fn-muted" style={{ fontSize: 13, margin: 0 }}>
          追加できるイベントはありません。
        </p>
      )}

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" style={{ color: "var(--accent-success)", fontSize: 13, margin: 0 }}>
          {message}
        </p>
      ) : null}

      {members.length === 0 ? (
        <p className="fn-muted" style={{ fontSize: 13, margin: 0 }}>
          所属イベントはまだありません。
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members.map((m) => (
            <div
              key={m.event_id}
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                padding: "10px 12px",
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <Link
                  to={`/manage/events/${encodeURIComponent(m.event_id)}`}
                  style={{ fontWeight: 600, fontSize: 13 }}
                >
                  {m.title}
                </Link>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {m.start_time != null
                    ? formatEventUnix(m.start_time, true)
                    : "日時未設定"}
                </div>
              </div>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => void onRemove(m.event_id)}
                disabled={busy}
              >
                外す
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
