/** MIG-0724 U03b: mount authorized read-only Manage videos under the Ops guard.
 * No status mutation callbacks are supplied until MIG-0603 is approved and merged.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { createManageVideosApi } from "../../api/manageVideos.js";
import { createManageVideoDetailApi } from "../../api/manageVideoDetail.js";
import type { OpsFetch } from "../../api/read.js";
import { EventVideos } from "./EventVideos.js";
import { EventVideoDetail } from "./EventVideoDetail.js";

const browserFetch: OpsFetch = (input, init) => fetch(input, init);

export function ManageVideosRoute({ fetchFn = browserFetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id } = useParams<"id">();
  const api = React.useMemo(() => createManageVideosApi(fetchFn), [fetchFn]);
  return id ? <EventVideos eventId={id} api={api} /> :
    <p role="alert">イベントIDが不正です。</p>;
}

export function ManageVideoDetailRoute({ fetchFn = browserFetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id, videoId } = useParams<"id" | "videoId">();
  const api = React.useMemo(() => createManageVideoDetailApi(fetchFn), [fetchFn]);
  return id && videoId ? <EventVideoDetail eventId={id} videoId={videoId} api={api} /> :
    <p role="alert">イベントIDまたは作品IDが不正です。</p>;
}
