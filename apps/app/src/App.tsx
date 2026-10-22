import React from "react";
import { BrowserRouter } from "react-router-dom";
import { createPersonalApi, type PersonalApi } from "./api/personal.js";
import { PersonalRoutes } from "./routes/router.js";

const defaultApi = createPersonalApi();

export function App({ api = defaultApi }: { api?: PersonalApi }) {
  return (
    <BrowserRouter>
      <PersonalRoutes api={api} />
    </BrowserRouter>
  );
}
