import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { AdminEventsResponse } from "@flamenode/contracts";
import {
  eventDisplayState,
  eventIndexQuery,
  formatEventUnix,
  readAdminEvents,
} from "../../api/adminEvents.js";
import { adminReadRedirect } from "../../api/adminTop.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { Icon } from "../../components/shared/Icon.js";
import { IME_COMPOSING_FORM_ATTR, isImeComposingForm } from "../../components/shared/imeSafeSearch.js";

/** MIG-0728 U02/U03: CURRENT /admin/events with D-17-2 redirect, shared shell, and IME-safe search. */
export function AdminEvents({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const urlParams = new URLSearchParams(search);
  const notice = (urlParams.get("notice") ?? "").slice(0, 200);
  const error = (urlParams.get("error") ?? "").slice(0, 200);
  const key = eventIndexQuery(params);
  const [result, setResult] = React.useState<OpsResult<AdminEventsResponse> | null>(null);
  // Match CURRENT AutoSubmitSelect/ImeSafeGetForm: an IME candidate commit
  // must not submit a partially converted search value.
  const composingTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (composingTimer.current !== null) window.clearTimeout(composingTimer.current);
  }, []);
  const clearComposingTimer = (): void => {
    if (composingTimer.current !== null) {
      window.clearTimeout(composingTimer.current);
      composingTimer.current = null;
    }
  };
  const beginComposition = (form: HTMLFormElement): void => {
    clearComposingTimer();
    form.setAttribute(IME_COMPOSING_FORM_ATTR, "");
  };
  const endComposition = (form: HTMLFormElement): void => {
    clearComposingTimer();
    composingTimer.current = window.setTimeout(() => {
      form.removeAttribute(IME_COMPOSING_FORM_ATTR);
      composingTimer.current = null;
    }, 0);
  };
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null); // Do not show stale or cross-account privileged data.
    void readAdminEvents(new URLSearchParams(key), fetchFn, controller.signal).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [key, fetchFn]);

  const redirect = result ? adminReadRedirect(result) : null;
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (result && (result.status === "anonymous" || result.status === "forbidden")) {
    return <p role="status">読み込み中…</p>;
  }

  function change(form: HTMLFormElement): void {
    if (isImeComposingForm(form)) return;
    const fd = new FormData(form);
    const next = new URLSearchParams();
    for (const field of ["q", "filter", "sort"]) {
      const value = fd.get(field);
      if (typeof value === "string") next.set(field, value);
    }
    setParams(eventIndexQuery(next));
  }
  const current = new URLSearchParams(key);
  return (
    <section className="fn-page" aria-label="全イベント管理">
      <ConsolePageHeader
        title="全イベント管理"
        description="イベントの作成・公開設定・運営メンバー管理を行います。"
        actions={[
          {
            href: "/admin/events/new",
            label: "新規イベント",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

      {notice ? (
        <p className="fn-alert fn-alert-success" role="status" style={{ marginBottom: 12 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="fn-alert fn-alert-danger" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      <form
        method="get"
        role="search"
        style={{
          marginTop: 14,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
        onCompositionStart={(e) => beginComposition(e.currentTarget)}
        onCompositionEnd={(e) => endComposition(e.currentTarget)}
        onKeyDown={(e) => {
          const form = e.currentTarget;
          if (e.nativeEvent.isComposing) {
            if (!isImeComposingForm(form)) beginComposition(form);
          } else if (e.nativeEvent.keyCode === 229 && !isImeComposingForm(form)) {
            // Windows IME may send Process/229 without compositionstart.
            beginComposition(form);
            endComposition(form);
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          change(e.currentTarget);
        }}
      >
        <input
          className="fn-input"
          type="search"
          name="q"
          aria-label="タイトル / ID で検索"
          placeholder="タイトル / ID で検索"
          defaultValue={current.get("q") ?? ""}
          key={"q:" + key}
          style={{ maxWidth: 240 }}
        />
        <select
          className="fn-select"
          name="filter"
          aria-label="公開状態"
          value={current.get("filter") ?? "all"}
          onChange={(e) => {
            const form = e.currentTarget.form;
            if (form && !isImeComposingForm(form)) form.requestSubmit();
          }}
        >
          <option value="all">全イベント</option>
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="accepting">受付中のみ</option>
        </select>
        <select
          className="fn-select"
          name="sort"
          aria-label="開催日"
          value={current.get("sort") ?? "newest"}
          onChange={(e) => {
            const form = e.currentTarget.form;
            if (form && !isImeComposingForm(form)) form.requestSubmit();
          }}
        >
          <option value="newest">開催日 新→旧</option>
          <option value="oldest">開催日 旧→新</option>
          <option value="upcoming">開催日 早い順</option>
        </select>
        <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
          検索
        </button>
      </form>
      {result == null ? <p role="status">読み込み中...</p> : null}
      {result != null && result.status !== "ok" ? (
        <p role="alert">イベントを取得できませんでした。再ログインまたは再読み込みしてください。</p>
      ) : null}
      {result?.status === "ok" ? (
        <>
          <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
            {result.data.events.length} 件表示中 (上限 60)
          </p>
          {result.data.events.length === 0 ? (
            <EmptyState
              tone="neutral"
              title="まだイベントがありません"
              description="最初のイベントを作成すると、募集・投稿枠・運営メンバーを管理できるようになります。"
              actions={[
                { href: "/admin/events/new", label: "新規イベントを作成", variant: "primary" },
                { href: "/admin/events/templates", label: "テンプレートを見る", variant: "ghost" },
              ]}
            />
          ) : (
            <FnTable style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th scope="col">イベント名</th>
                  <th scope="col">期間</th>
                  <th scope="col">状態</th>
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {result.data.events.map((ev) => {
                  const state = eventDisplayState(ev, result.data.now);
                  const id = encodeURIComponent(ev.id);
                  return (
                    <tr key={ev.id}>
                      <td>
                        <strong>{ev.title}</strong>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ev.id}</div>
                      </td>
                      <td>
                        {formatEventUnix(ev.start_time, true)}
                        {ev.end_time != null ? " 〜 " + formatEventUnix(ev.end_time, true) : ""}
                      </td>
                      <td>
                        <span
                          className={`fn-badge ${
                            state.label === "開催中" || state.label === "公開"
                              ? "fn-badge-accent"
                              : "fn-badge-soft"
                          }`}
                        >
                          {state.label}
                        </span>
                        {state.accepting ? (
                          <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
                            受付中
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <div className="fn-console-row-actions">
                          <Link
                            to={"/manage/events/" + id + "/edit"}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                          >
                            運営設定を開く
                          </Link>
                          <Link
                            to={"/manage/events/" + id}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                          >
                            運営ビュー
                          </Link>
                          <Link
                            to={"/manage/events/" + id + "/staff"}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                          >
                            運営権限を編集
                          </Link>
                          <Link
                            to={"/admin/audit?table=events&record=" + id}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                            title="このイベントの監査ログ"
                          >
                            監査
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </FnTable>
          )}
        </>
      ) : null}
    </section>
  );
}
