import React from "react";
import { sanitizeNextPath } from "../../../../src/lib/utils/next.ts";
import { signOutViaAuthRoute } from "../../../../src/lib/client/authSignOutClient.ts";
import {
  dispatchActiveXChanged,
  dispatchBeforeActiveXSwitch,
} from "../../../../src/lib/client/activeXSwitchEvents.ts";
import {
  getSiteAccountStore,
  normalizeXIdEntries,
  resolveDisplayName,
  sortXIdEntries,
  type AccountState,
  type AccountStore,
  type XIdEntry,
} from "../lib/accountSummary.ts";

/**
 * Header account Island (CURRENT `PublicAccountIsland` + `AccountMenu`, MIG-0507 U08). Two slots of the shared
 * `PublicHeader`: `AccountSlot` (desktop: post / join link and the account menu) and `MobileAccountSlot`
 * (the mobile menu section). Both read one shared store (`lib/accountSummary.ts`, RH-001); the full summary is
 * fetched only when a menu is opened. Management links show only from the full summary, never from presence.
 *
 * Active X switching in CURRENT is the `setActiveXId` Server Action; Hono has no such endpoint yet (MIG-0605), so
 * the switch is an injected `switchActiveX`. Without it the choices are shown disabled instead of doing nothing.
 */
const h = React.createElement;

export type SwitchActiveX = (xUserId: string) => Promise<{ ok: boolean; message?: string }>;

export interface AccountSlotProps {
  currentPath?: string;
  store?: AccountStore;
  switchActiveX?: SwitchActiveX;
}

function useAccountState(store: AccountStore): AccountState {
  React.useEffect(() => {
    store.start();
  }, [store]);
  return React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function entryHrefFor(currentPath: string | undefined): string {
  const next = sanitizeNextPath(currentPath ?? "/", "/");
  return next === "/entry" ? "/entry" : `/entry?next=${encodeURIComponent(next)}`;
}

function Avatar({ src, className }: { src: string | null | undefined; className: string }): React.ReactElement {
  return src ? h("img", { src, alt: "", className }) : h("span", { className: `${className} fallback`, "aria-hidden": "true" });
}

function SignOutButton({ className }: { className: string }): React.ReactElement {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const click = async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await signOutViaAuthRoute();
      if (result.ok) {
        window.location.replace("/");
        return;
      }
      setError(result.message);
    } catch {
      setError("ログアウトに失敗しました。再読み込みしてもう一度お試しください。");
    } finally {
      setPending(false);
    }
  };
  return h(
    React.Fragment,
    null,
    h("button", { type: "button", className, role: "menuitem", disabled: pending, "aria-busy": pending, onClick: click }, pending ? "ログアウト中…" : "ログアウト"),
    error ? h("p", { role: "alert" }, error) : null,
  );
}

/** CURRENT `useActiveXSwitcher`: approved-only, cancelable before-event, optimistic with rollback. */
function useActiveXSwitcher(entries: readonly XIdEntry[], switchActiveX: SwitchActiveX | undefined, onSuccess: () => void) {
  const normalized = React.useMemo(() => normalizeXIdEntries(entries), [entries]);
  const [activeId, setActiveId] = React.useState<string | null>(normalized.find((e) => e.is_active)?.x_user_id ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    setActiveId(normalized.find((e) => e.is_active)?.x_user_id ?? null);
  }, [normalized]);
  const switchTo = async (entry: XIdEntry) => {
    setError(null);
    if (entry.x_user_id === activeId) return onSuccess();
    if (entry.approval_status !== "approved") {
      setError(entry.approval_status === "rejected" ? "却下された X ID はアクティブにできません。" : "承認済みの X ID だけをアクティブにできます。");
      return;
    }
    if (!switchActiveX) return;
    const fromXId = activeId;
    const toXId = entry.x_user_id;
    if (!dispatchBeforeActiveXSwitch({ fromXId, toXId })) return;
    setActiveId(toXId);
    setPending(true);
    try {
      const result = await switchActiveX(toXId);
      if (!result.ok) {
        setActiveId(fromXId);
        setError(result.message ?? "X ID の切り替えに失敗しました。");
        return;
      }
      dispatchActiveXChanged({ fromXId, toXId });
      onSuccess();
    } catch {
      setActiveId(fromXId);
      setError("X ID の切り替えに失敗しました。");
    } finally {
      setPending(false);
    }
  };
  return {
    entries: normalized,
    activeId,
    activeEntry: normalized.find((e) => e.x_user_id === activeId) ?? null,
    pending,
    error,
    clearError: () => setError(null),
    switchTo,
  };
}

function XIdChoice(props: { entry: XIdEntry; disabled: boolean; role?: string; onPick: () => void }): React.ReactElement {
  const { entry } = props;
  return h(
    "button",
    { type: "button", role: props.role, className: "hd-xid", disabled: props.disabled, onClick: props.onPick },
    h(Avatar, { src: entry.icon_url, className: "avatar" }),
    h("span", { className: "ell" }, entry.x_name, " ", h("span", { className: "t-sm muted" }, `@${entry.x_user_id}`)),
  );
}

function Notice(props: { tone?: "danger"; title: string; children?: React.ReactNode }): React.ReactElement {
  return h(
    "div",
    { className: `hd-acc-note${props.tone ? ` ${props.tone}` : ""}` },
    h("strong", null, props.title),
    props.children,
  );
}

function XIdStatus(props: {
  details: NonNullable<AccountState["details"]>;
  entries: XIdEntry[];
  activeEntry: XIdEntry | null;
  pickDisabled: boolean;
  onPick: (entry: XIdEntry) => void;
}): React.ReactElement | null {
  const { entries, activeEntry } = props;
  const approved = sortXIdEntries(entries.filter((e) => e.approval_status === "approved"));
  const pendingList = sortXIdEntries(entries.filter((e) => e.approval_status === "pending"));
  if (!activeEntry) {
    if (entries.length === 0) {
      return h(
        Notice,
        { title: "X ID未連携" },
        h("p", null, "いいね・セーブ・投稿には、利用規約への同意と承認済みの活動名義（Active X ID）が必要です。枠確保は規約同意後から可能で、投稿は X ID 承認後です。"),
        h("a", { href: "/dashboard/settings", className: "hd-acc-sub" }, "X IDを連携する"),
      );
    }
    if (approved.length === 0) {
      return h(
        Notice,
        { title: pendingList.length > 0 ? "X ID連携申請中" : "承認済みX IDなし" },
        h("p", null, pendingList.length > 0 ? "申請履歴と承認状況は設定から確認できます。" : "承認済みの X ID がないためアクティブにできません。設定から申請してください。"),
        ...pendingList.map((entry) => h("div", { key: entry.x_user_id, className: "hd-xid" }, h("span", { className: "ell" }, entry.x_name, " ", `@${entry.x_user_id}`), h("span", null, "承認待ち"))),
        h("a", { href: "/dashboard/settings", className: "hd-acc-sub" }, "設定を開く"),
      );
    }
    return h(
      Notice,
      { title: "Active X ID未選択" },
      h("p", null, "承認済みの X ID からアクティブにするものを選んでください。"),
      ...approved.map((entry) => h(XIdChoice, { key: entry.x_user_id, entry, disabled: props.pickDisabled, onPick: () => props.onPick(entry) })),
      h("a", { href: "/dashboard/settings", className: "hd-acc-sub" }, "設定を開く"),
    );
  }
  if (activeEntry.approval_status === "pending") {
    return h(Notice, { title: "承認待ち" }, h("p", null, "できること: 作品の閲覧、枠確保"), h("p", null, "できないこと: いいね、セーブ、投稿、コメント（承認後に利用可能）"));
  }
  if (activeEntry.approval_status === "rejected") {
    return h(Notice, { tone: "danger", title: "却下済み" }, h("p", null, "このX IDは使用できません。設定から別のX IDを申請してください。"));
  }
  return null;
}

function AccountMenu(props: { state: AccountState; store: AccountStore; switchActiveX?: SwitchActiveX }): React.ReactElement {
  const { state, store, switchActiveX } = props;
  const user = state.user!;
  const details = state.details;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const switcher = useActiveXSwitcher(details?.xIds ?? [], switchActiveX, () => setOpen(false));
  const { activeEntry, activeId } = switcher;

  React.useEffect(() => {
    if (!open) return;
    store.requestDetails();
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, store]);

  const name = resolveDisplayName(user.name, activeEntry, details?.degraded === true);
  const icon = activeEntry?.icon_url ?? user.image;
  const profileHref = activeEntry?.approval_status === "approved" ? `/user/${encodeURIComponent(activeEntry.x_user_id)}` : null;
  const switchable = sortXIdEntries(switcher.entries.filter((e) => e.approval_status === "approved" && e.x_user_id !== activeId));
  const canManage = details?.canAccessManage === true;
  const canAdmin = details?.canAccessAdmin === true;
  const me = h(
    React.Fragment,
    null,
    h(Avatar, { src: icon, className: "avatar" }),
    h("span", { className: "stack" }, h("b", null, name), h("span", { className: "t-sm muted" }, activeEntry ? `@${activeEntry.x_user_id}` : user.name)),
  );

  return h(
    "div",
    { ref, className: "hd-acc-wrap" },
    h(
      "button",
      {
        type: "button",
        className: `hd-acc-btn${open ? " on" : ""}`,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-label": "アカウントメニューを開く",
        onClick: () => {
          switcher.clearError();
          setOpen((current) => !current);
        },
      },
      h(Avatar, { src: icon, className: "avatar hd-me" }),
      h("span", { className: "hd-acc-id" }, name),
      activeEntry?.approval_status === "pending" ? h("span", { className: "hd-acc-badge", title: "承認待ち" }) : null,
      activeEntry?.approval_status === "rejected" ? h("span", { className: "hd-acc-badge danger", title: "却下" }) : null,
    ),
    open
      ? h(
          "div",
          { className: "hd-pop hd-acc", role: "menu", "aria-label": "アカウント" },
          switcher.error ? h("div", { className: "hd-acc-note danger", role: "alert" }, switcher.error) : null,
          profileHref
            ? h("a", { href: profileHref, className: "hd-acc-me", role: "menuitem", onClick: () => setOpen(false) }, me)
            : h("div", { className: "hd-acc-me" }, me),
          !details
            ? h(
                "div",
                { className: "hd-acc-note", role: "status", "aria-busy": state.detailsLoading },
                h("strong", null, state.detailsUnavailable ? "アカウント情報を取得できません" : "アカウント情報を確認中"),
                h("p", null, "X ID と管理メニューは、最新のアカウント情報を確認してから表示します。"),
                state.detailsUnavailable ? h("button", { type: "button", className: "hd-acc-l", onClick: () => store.retryDetails() }, "再試行") : null,
              )
            : h(XIdStatus, { details, entries: switcher.entries, activeEntry, pickDisabled: switcher.pending || !switchActiveX, onPick: switcher.switchTo }),
          switchable.length > 0
            ? h(
                React.Fragment,
                null,
                h("div", { className: "hd-acc-sep" }),
                h("span", { className: "t-label muted hd-acc-h" }, "別の X ID に切り替え"),
                ...switchable.map((entry) =>
                  h(XIdChoice, { key: entry.x_user_id, entry, role: "menuitem", disabled: switcher.pending || !switchActiveX, onPick: () => switcher.switchTo(entry) }),
                ),
              )
            : null,
          h("div", { className: "hd-acc-sep" }),
          h("a", { href: "/dashboard", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "ダッシュボード"),
          h("a", { href: "/dashboard/library", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "ライブラリ"),
          h("a", { href: "/dashboard/settings", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "設定"),
          h("a", { href: "/entry", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "新規投稿"),
          details && (canManage || canAdmin)
            ? h(
                React.Fragment,
                null,
                h("div", { className: "hd-acc-sep" }),
                canManage ? h("a", { href: "/manage", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "運営") : null,
                canAdmin ? h("a", { href: "/admin", className: "hd-acc-l", role: "menuitem", onClick: () => setOpen(false) }, "管理") : null,
              )
            : null,
          h("div", { className: "hd-acc-sep" }),
          h(SignOutButton, { className: "hd-acc-l" }),
        )
      : null,
  );
}

/** Desktop slot (`PublicHeader` `account`). */
export function AccountSlot({ currentPath, store = getSiteAccountStore(), switchActiveX }: AccountSlotProps): React.ReactElement | null {
  const state = useAccountState(store);
  if (state.loading) {
    return h("span", { className: "hd-acc-ph", role: "status", "aria-label": "ログイン状態を確認中" });
  }
  if (state.unavailable && !state.user) {
    return h("button", { type: "button", className: "hd-acc-retry", onClick: () => store.retryDetails(), title: "ログイン状態をもう一度確認します" }, "ログイン状態を再確認");
  }
  if (state.user) {
    return h(
      React.Fragment,
      null,
      h("a", { href: "/entry", className: "hd-post-link" }, "投稿する"),
      h(AccountMenu, { state, store, switchActiveX }),
    );
  }
  return h("a", { href: entryHrefFor(currentPath), className: "hd-post-link" }, "参加する");
}

/** Mobile menu slot (`PublicHeader` `mobileAccount`); mounting it means the menu is open, so details are requested. */
export function MobileAccountSlot({ currentPath, store = getSiteAccountStore() }: AccountSlotProps): React.ReactElement | null {
  const state = useAccountState(store);
  React.useEffect(() => {
    store.requestDetails();
  }, [store, state.user]);
  if (state.loading) return h("div", { "aria-busy": "true" });
  if (state.unavailable && !state.user) {
    return h("button", { type: "button", className: "hd-acc-l", onClick: () => store.retryDetails() }, "ログイン状態を再確認");
  }
  const user = state.user;
  if (!user) return h("a", { href: entryHrefFor(currentPath), className: "hd-acc-l" }, "参加する");
  const details = state.details;
  const active = details ? normalizeXIdEntries(details.xIds).find((e) => e.is_active) : undefined;
  const status = !details
    ? state.detailsUnavailable
      ? "アカウント詳細を取得できません"
      : "アカウント詳細を確認中"
    : active
      ? `@${active.x_user_id}`
      : "Active X ID未選択";
  return h(
    React.Fragment,
    null,
    h("a", { href: "/entry", className: "hd-acc-l" }, "投稿する"),
    h(
      "div",
      { className: "hd-acc-me" },
      h(Avatar, { src: user.image, className: "avatar" }),
      h("span", { className: "stack" }, h("b", null, user.name), h("span", { className: "t-sm muted" }, status), details ? h("small", null, "現在の投稿・コメントの活動名義") : null),
    ),
    !details && state.detailsUnavailable
      ? h("button", { type: "button", className: "hd-acc-l", onClick: () => state.detailsUnavailable && store.retryDetails() }, "アカウント情報を再確認")
      : null,
    h("a", { href: "/dashboard", className: "hd-acc-l" }, "マイページ"),
    h("a", { href: "/dashboard/library", className: "hd-acc-l" }, "ライブラリ"),
    h("a", { href: "/dashboard/settings", className: "hd-acc-l" }, "設定"),
    details?.canAccessManage ? h("a", { href: "/manage", className: "hd-acc-l" }, "運営") : null,
    details?.canAccessAdmin ? h("a", { href: "/admin", className: "hd-acc-l" }, "管理") : null,
    h(SignOutButton, { className: "hd-acc-l" }),
  );
}
