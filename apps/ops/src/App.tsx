import React from "react";
import { BrowserRouter } from "react-router-dom";
import { createOpsApi, type OpsApi } from "./api/account.js";
import { OpsRoutes } from "./routes/router.js";

const defaultApi = createOpsApi();

/** MIG-0707 U02: non-production Ops shell. Server APIs enforce actual authorization. */
export function App({ api = defaultApi }: { api?: OpsApi }): React.ReactElement {
  return <BrowserRouter><OpsRoutes api={api} /></BrowserRouter>;
}
