import React from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { createOpsApi, type OpsApi } from "./api/account.js";
import { OpsRoutes } from "./routes/router.js";

const defaultApi = createOpsApi();

/** MIG-0707 U02: non-production Ops shell. Server APIs enforce actual authorization. */
export function App({ api = defaultApi }: { api?: OpsApi }): React.ReactElement {
  const [instance, setInstance] = React.useState<{
    api: OpsApi;
    router: ReturnType<typeof createBrowserRouter>;
  } | null>(null);

  React.useEffect(() => {
    // Router creation installs history listeners. Pair it with disposal even
    // when StrictMode repeats the effect, without changing the owned routes.
    const router = createBrowserRouter([{ path: "*", element: <OpsRoutes api={api} /> }]);
    setInstance({ api, router });
    return () => router.dispose();
  }, [api]);

  // A different API instance must not briefly inherit the old authorization.
  if (instance?.api !== api) {
    return <div role="status" aria-busy="true" className="fn-public-container fn-page">読み込み中...</div>;
  }
  return <RouterProvider router={instance.router} />;
}
