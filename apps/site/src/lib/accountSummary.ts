import { normalizeXId } from "../../../../src/lib/utils/xid.ts";
import { ACTIVE_X_CHANGED_EVENT } from "../../../../src/lib/client/activeXSwitchEvents.ts";

/**
 * Header account state (CURRENT `usePublicAccountSummary`, without React). Source: RH-001
 * `GET /api/account/summary?view=presence` (name/icon) first, then `GET /api/account/summary` (X IDs, management
 * flags) only once a menu is opened. The response shapes are the CURRENT `lib/account/summary.ts` types that the
 * Hono route (MIG-0605 U01) returns unchanged. Identity display only; no authorization decision is made here.
 */
export const ACCOUNT_FETCH_TIMEOUT_MS = 5_000;

export interface XIdEntry {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "approved" | "pending" | "rejected";
  is_active: boolean;
}

export type AccountSummaryResponse =
  | { loggedIn: false; unavailable?: true }
  | {
      loggedIn: true;
      displayName: string;
      icon: string | null;
      role: string;
      activeXId: string | null;
      xIds: XIdEntry[];
      canAccessAdmin: boolean;
      canAccessManage: boolean;
      degraded?: true;
    };

export type AccountPresenceResponse =
  | { view: "presence"; loggedIn: false; unavailable?: true }
  | { view: "presence"; loggedIn: true; displayName: string; icon: string | null };

export interface AccountDetails {
  xIds: XIdEntry[];
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  degraded: boolean;
}

export interface AccountState {
  /** True until the first presence answer (or failure) arrives. */
  loading: boolean;
  user: { name: string; image: string | null } | null;
  unavailable: boolean;
  confirmedLoggedOut: boolean;
  details: AccountDetails | null;
  detailsLoading: boolean;
  detailsUnavailable: boolean;
}

export interface AccountStore {
  getState(): AccountState;
  subscribe(listener: () => void): () => void;
  start(): void;
  requestDetails(): void;
  retryDetails(): void;
  dispose(): void;
}

export interface AccountStoreOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function normalizeXIdEntries(entries: readonly XIdEntry[]): XIdEntry[] {
  const seen = new Set<string>();
  const out: XIdEntry[] = [];
  for (const entry of entries) {
    const id = normalizeXId(entry.x_user_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...entry, x_user_id: id, x_name: entry.x_name?.trim() || `@${id}` });
  }
  return out;
}

function approvalRank(status: string): number {
  return status === "approved" ? 0 : status === "rejected" ? 2 : 1;
}

export function sortXIdEntries(entries: readonly XIdEntry[]): XIdEntry[] {
  return [...entries].sort(
    (a, b) => approvalRank(a.approval_status) - approvalRank(b.approval_status) || a.x_name.localeCompare(b.x_name, "ja"),
  );
}

/** CURRENT `resolveAccountMenuDisplayName`: the X name unless it is only the `@handle`, then the account name. */
export function resolveDisplayName(accountName: string, active: XIdEntry | null | undefined, degraded: boolean): string {
  const fallback = accountName.trim() || "guest";
  const xName = active?.x_name.trim();
  if (degraded || !xName || !active) return fallback;
  const synthetic = xName.startsWith("@") && normalizeXId(xName) === normalizeXId(active.x_user_id);
  return synthetic ? fallback : xName;
}

export function createAccountStore(options: AccountStoreOptions = {}): AccountStore {
  const timeoutMs = options.timeoutMs ?? ACCOUNT_FETCH_TIMEOUT_MS;
  let state: AccountState = {
    loading: true,
    user: null,
    unavailable: false,
    confirmedLoggedOut: false,
    details: null,
    detailsLoading: false,
    detailsUnavailable: false,
  };
  const listeners = new Set<() => void>();
  let started = false;
  let disposed = false;
  let presenceLoaded = false;
  let presenceRunning = false;
  let detailsRequested = false;
  let detailsRunning = false;

  const set = (patch: Partial<AccountState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function getJson<T>(url: string): Promise<{ status: "ok"; body: T } | { status: "failed" }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const fetcher = options.fetchImpl ?? fetch;
      const response = await fetcher(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (response.status === 503 || !response.ok) return { status: "failed" };
      return { status: "ok", body: (await response.json()) as T };
    } catch {
      return { status: "failed" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadPresence(): Promise<void> {
    if (presenceLoaded || presenceRunning || disposed) return;
    presenceRunning = true;
    set({ loading: true });
    const result = await getJson<AccountPresenceResponse>("/api/account/summary?view=presence");
    presenceRunning = false;
    if (disposed) return;
    // CURRENT keeps an already shown user when a later check fails (preserveLoggedInOnFailure).
    if (result.status === "failed" || (!result.body.loggedIn && result.body.unavailable)) {
      set({ loading: false, unavailable: true });
      return;
    }
    presenceLoaded = true;
    if (result.body.loggedIn) {
      set({
        loading: false,
        unavailable: false,
        user: { name: result.body.displayName, image: result.body.icon },
        confirmedLoggedOut: false,
        details: null,
        detailsUnavailable: false,
      });
      if (detailsRequested) void loadDetails();
    } else {
      set({ loading: false, unavailable: false, user: null, confirmedLoggedOut: true, details: null, detailsUnavailable: false });
    }
  }

  async function loadDetails(): Promise<void> {
    if (!detailsRequested || !presenceLoaded || !state.user || state.details || detailsRunning || disposed) return;
    detailsRunning = true;
    set({ detailsLoading: true });
    const result = await getJson<AccountSummaryResponse>("/api/account/summary");
    detailsRunning = false;
    if (disposed) return;
    if (result.status === "failed" || (!result.body.loggedIn && result.body.unavailable)) {
      set({ detailsLoading: false, detailsUnavailable: true });
      return;
    }
    if (result.body.loggedIn) {
      const summary = result.body;
      set({
        detailsLoading: false,
        detailsUnavailable: false,
        confirmedLoggedOut: false,
        details: {
          xIds: summary.xIds,
          canAccessAdmin: summary.canAccessAdmin,
          canAccessManage: summary.canAccessManage,
          degraded: summary.degraded === true,
        },
      });
    } else {
      set({ detailsLoading: false, user: null, details: null, confirmedLoggedOut: true, detailsUnavailable: false });
    }
  }

  // CURRENT: an Active X change invalidates the details and fetches them again.
  const onActiveXChanged = () => {
    detailsRequested = true;
    set({ details: null, detailsUnavailable: false });
    void loadDetails();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      window.addEventListener(ACTIVE_X_CHANGED_EVENT, onActiveXChanged);
      void loadPresence();
    },
    requestDetails() {
      detailsRequested = true;
      if (state.detailsUnavailable) return;
      void loadDetails();
    },
    retryDetails() {
      if (presenceLoaded) {
        set({ detailsUnavailable: false });
        void loadDetails();
      } else {
        set({ unavailable: false });
        void loadPresence();
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (started) window.removeEventListener(ACTIVE_X_CHANGED_EVENT, onActiveXChanged);
    },
  };
}

let siteStore: AccountStore | null = null;
/** One store per page, shared by the desktop menu and the mobile menu section. */
export function getSiteAccountStore(): AccountStore {
  siteStore ??= createAccountStore();
  return siteStore;
}
