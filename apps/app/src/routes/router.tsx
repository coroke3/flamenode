import * as React from "react";
import { Route, Routes } from "react-router-dom";
import type { PersonalApi } from "../api/personal.js";
import { AuthErrorView } from "./guard.js";
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

/** CURRENT app/(auth)/error.tsx equivalent: `reset` clears the failure and re-renders. */
export class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <AuthErrorView error={error} reset={() => this.setState({ error: null })} />;
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
