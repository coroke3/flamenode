import * as React from "react";
import { Navigate, useParams } from "react-router-dom";
export function manageReviewTarget(id: string): string {
  return "/manage/events/" + encodeURIComponent(id) + "/videos?status=pending";
}
export function ManageReviewRedirect(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) return <div role="alert">イベントが見つかりません。</div>;
  return <Navigate replace to={manageReviewTarget(id)} />;
}
