import * as React from "react";
import { Navigate } from "react-router-dom";
import type { PersonalApi } from "../../api/session.js";
import { SessionGate } from "../guard.js";
import { youtubePlaylistsTarget } from "../next.js";

/** Leaves this SPA (admin is a separate SPA, D-05) with a full navigation. */
function ExternalRedirect({ to }: { to: string }): null {
  React.useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}

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
