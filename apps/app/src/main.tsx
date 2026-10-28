import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/current/globals.css";
import "./styles/current/mobile-hardening.css";
import "./styles/fonts.css";
import "./styles/video-card.css";
import "./styles/dashboard.css";
import "./styles/settings.css";
import "./styles/onboarding.css";
import "./styles/forms-a.css";
import { App } from "./App.js";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
