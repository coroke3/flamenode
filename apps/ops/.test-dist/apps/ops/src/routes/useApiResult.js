import * as React from "react";
const LOADING = { status: "loading" };
export function useApiResult(fetchFn, key, refreshKey = 0) {
    const [state, setState] = React.useState(LOADING);
    const loadRef = React.useRef(fetchFn);
    const shownKey = React.useRef(null);
    loadRef.current = fetchFn;
    React.useEffect(() => {
        const controller = new AbortController();
        const silent = shownKey.current === key;
        shownKey.current = key;
        if (!silent)
            setState(LOADING);
        void (async () => {
            try {
                const result = await loadRef.current(controller.signal);
                // Only transport/unavailability errors may retain the last successful data.
                // A same-key refresh can lose authentication, permissions, or the resource itself.
                // Never keep private data mounted after an explicit non-transient server response.
                if (!controller.signal.aborted && (!silent || result.status !== "unavailable")) {
                    setState(result);
                }
            }
            catch {
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
