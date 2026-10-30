import * as React from "react";
import type { OpsResult } from "../api/read.js";

/**
 * MIG-0707 U05b (D-17-3): one cancellable Ops read per key.
 * Refreshing the same key preserves already-visible data on transient errors,
 * matching CURRENT router.refresh() without exposing a stale result for a new key.
 */
export type OpsDataState<T> = { status: "loading" } | OpsResult<T>;
export type OpsLoader<T> = (signal: AbortSignal) => Promise<OpsResult<T>>;

const LOADING = { status: "loading" } as const;

export function useApiResult<T>(
  fetchFn: OpsLoader<T>,
  key: string,
  refreshKey = 0,
): OpsDataState<T> {
  const [state, setState] = React.useState<OpsDataState<T>>(LOADING);
  const loadRef = React.useRef(fetchFn);
  const shownKey = React.useRef<string | null>(null);
  loadRef.current = fetchFn;

  React.useEffect(() => {
    const controller = new AbortController();
    const silent = shownKey.current === key;
    shownKey.current = key;
    if (!silent) setState(LOADING);

    void (async () => {
      try {
        const result = await loadRef.current(controller.signal);
        // Only transport/unavailability errors may retain the last successful data.
        // A same-key refresh can lose authentication, permissions, or the resource itself.
        // Never keep private data mounted after an explicit non-transient server response.
        if (!controller.signal.aborted && (!silent || result.status !== "unavailable")) {
          setState(result);
        }
      } catch {
        if (!controller.signal.aborted && !silent) {
          setState({ status: "unavailable" });
        }
      }
    })();

    return () => controller.abort();
  }, [key, refreshKey]);

  // Effects execute after render; the first render for a new key must not expose
  // data produced for the previous event/account, even for a single frame.
  return shownKey.current === key ? state : LOADING;
}
