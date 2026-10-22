import React from "react";
import { BrowserRouter } from "react-router-dom";
import { unwiredPersonalApi, type PersonalApi } from "./api/session.js";
import { PersonalRoutes } from "./routes/router.js";

export function App({ api = unwiredPersonalApi }: { api?: PersonalApi }) {
  return (
    <BrowserRouter>
      <PersonalRoutes api={api} />
    </BrowserRouter>
  );
}
