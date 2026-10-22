import * as React from "react";
import { Route, Routes } from "react-router-dom";
import type { PersonalApi } from "../api/session.js";
import { Dashboard } from "./dashboard/Dashboard.js";
import { Library } from "./dashboard/Library.js";
import { Settings } from "./dashboard/Settings.js";
import { YoutubePlaylists } from "./dashboard/YoutubePlaylists.js";
import { Onboarding } from "./onboarding.js";

/** Routes owned by MIG-0701 (CURRENT_ROUTES.md Personal). Other Personal routes are later MIG tasks. */
export const PERSONAL_READ_PATHS = [
  "/dashboard",
  "/dashboard/library",
  "/dashboard/settings",
  "/dashboard/youtube-playlists",
  "/onboarding",
] as const;

export class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-empty fn-guard-card" role="alert">
          <h1 className="fn-guard-title">表示中にエラーが発生しました</h1>
          <p className="fn-empty-message">ページを再読み込みしてください。</p>
        </div>
      </div>
    );
  }
}

export function PersonalRoutes({ api }: { api: PersonalApi }): React.ReactElement {
  return (
    <RouteErrorBoundary>
      <Routes>
        <Route path="/dashboard" element={<Dashboard api={api} />} />
        <Route path="/dashboard/library" element={<Library api={api} />} />
        <Route path="/dashboard/settings" element={<Settings api={api} />} />
        <Route path="/dashboard/youtube-playlists" element={<YoutubePlaylists api={api} />} />
        <Route path="/onboarding" element={<Onboarding api={api} />} />
      </Routes>
    </RouteErrorBoundary>
  );
}
