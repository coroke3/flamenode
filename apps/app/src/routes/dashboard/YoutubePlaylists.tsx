import * as React from "react";
import { Navigate } from "react-router-dom";
import type { PersonalApi } from "../../api/personal.js";
import { SessionGate } from "../guard.js";
import { youtubePlaylistsTarget } from "../next.js";
import { ExternalRedirect } from "../ui/AppLink.js";

/** Admin is a separate SPA (D-05), so that target is a full navigation (ExternalRedirect). */

/** CURRENT COMPAT_REDIRECT: admin -> /admin/youtube-sync/playlists, others -> /dashboard. */
export function YoutubePlaylists({ api }: { api: PersonalApi }): React.ReactElement {
  return (
    <SessionGate api={api} next="/dashboard/youtube-playlists">
      {(user) => {
        const to = youtubePlaylistsTarget(user.role);
        return user.role === "admin" ? <ExternalRedirect to={to} /> : <Navigate to={to} replace />;
      }}
    </SessionGate>
  );
}
