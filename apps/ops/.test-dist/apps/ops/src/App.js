import { jsx as _jsx } from "react/jsx-runtime";
import { BrowserRouter } from "react-router-dom";
import { createOpsApi } from "./api/account.js";
import { OpsRoutes } from "./routes/router.js";
const defaultApi = createOpsApi();
/** MIG-0707 U02: non-production Ops shell. Server APIs enforce actual authorization. */
export function App({ api = defaultApi }) {
    return _jsx(BrowserRouter, { children: _jsx(OpsRoutes, { api: api }) });
}
