import "./styles/current/globals.css";
import "./styles/current/mobile-hardening.css";
import "./styles/fonts.css";
import "./styles/shared.css";
import "./styles/video-review.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";

// MIG-0707 U01: non-production bootstrap. U02 installs the guarded Ops router.
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
