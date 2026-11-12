import * as React from "react";
import { Outlet, Route, Routes, useParams } from "react-router-dom";
import type { OpsApi } from "../api/account.js";
import { CostGuardBanner } from "../components/layout/CostGuardBanner.js";
import { AdminLayout } from "./admin/AdminLayout.js";
import { AdminCostGuard } from "./admin/AdminCostGuard.js";
import { AdminNotifications } from "./admin/AdminNotifications.js";
import { AdminCompatRedirect } from "./admin/AdminRedirects.js";
import { AdminTop } from "./admin/AdminTop.js";
import { AdminXLinkRequests } from "./admin/AdminXLinkRequests.js";
import { AdminXIdMerges } from "./admin/AdminXIdMerges.js";
import { PermissionSimulator } from "./admin/PermissionSimulator.js";
import { StaticBuilds } from "./admin/StaticBuilds.js";
import { YoutubeSync } from "./admin/YoutubeSync.js";
import { YoutubePlaylists } from "./admin/YoutubePlaylists.js";
import { YoutubeQuota } from "./admin/YoutubeQuota.js";
import { AuthErrorView, OpsGate } from "./guard.js";
import { ManageLayout } from "./manage/ManageLayout.js";
import { ManageDashboard } from "./manage/ManageDashboard.js";
import { ManageReviewRedirect } from "./manage/ManageReviewRedirect.js";
import { EventStaffReadOnlyPage } from "./manage/EventStaffReadOnlyPage.js";
import type { OpsFetch } from "../api/read.js";

/** MIG-0707 U02: placeholder only. No protected screen data is served until its own MIG is reviewed. */
function UnmigratedView(): React.ReactElement {
  return <section aria-label="運営コンソール">移行準備中</section>;
}
export class OpsRouteErrorBoundary extends React.Component<
  { children: React.ReactNode }, { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <AuthErrorView error={this.state.error} reset={() => this.setState({ error: null })} />;
  }
}
/** MIG-0723 U03a: read-only staff route, still delegated to Hono per-event authorization. */
export function ManageStaffRoute({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id } = useParams<"id">();
  return id ? <EventStaffReadOnlyPage eventId={id} fetchFn={fetchFn} editable />
    : <p role="alert">イベントIDが不正です。</p>;
}

export function OpsRoutes({ api }: { api: OpsApi }): React.ReactElement {
  // MIG-0719: retain the MIG-0726 Admin shell and routes alongside Manage.
  const manage = (
    <OpsGate surface="manage" api={api}>
      <ManageLayout>
        <Routes>
          <Route index element={<ManageDashboard />} />
          <Route path="events/:id/review" element={<ManageReviewRedirect />} />
          <Route path="events/:id/staff" element={<ManageStaffRoute />} />
          <Route path="*" element={<UnmigratedView />} />
        </Routes>
      </ManageLayout>
    </OpsGate>
  );
  // MIG-0726: header/footer stay injected-null until FIX-0701-1 (D-13-6) gives both SPAs the shared ones.
  const adminFrame = (
    <AdminLayout api={api} banner={<CostGuardBanner source="admin" />} header={null} footer={null}>
      <Outlet />
    </AdminLayout>
  );
  return (
    <div data-fn-surface="ops" className="fn-app">
      <div className="fn-main flex-1 w-full">
        <OpsRouteErrorBoundary>
          <Routes>
            <Route path="/manage" element={manage} />
            <Route path="/manage/*" element={manage} />
            <Route path="/admin" element={adminFrame}>
              <Route index element={<AdminTop />} />
              <Route path="x-link-requests" element={<AdminXLinkRequests />} />
              <Route path="x-id-merges" element={<AdminXIdMerges />} />
              <Route path="permissions/simulator" element={<PermissionSimulator />} />
              <Route path="cost-guard" element={<AdminCostGuard />} />
              <Route path="notifications" element={<AdminNotifications />} />
              <Route path="static-builds" element={<StaticBuilds />} />
              <Route path="youtube-sync" element={<YoutubeSync />} />
              <Route path="youtube-sync/playlists" element={<YoutubePlaylists />} />
              <Route path="youtube-quota" element={<YoutubeQuota />} />
              <Route path="history" element={<AdminCompatRedirect />} />
              <Route path="events/new" element={<UnmigratedView />} />
              <Route path="events/templates" element={<UnmigratedView />} />
              <Route path="events/:id" element={<AdminCompatRedirect />} />
              <Route path="events/:id/edit" element={<AdminCompatRedirect />} />
              <Route path="events/:id/slots" element={<AdminCompatRedirect />} />
              <Route path="events/:id/staff" element={<AdminCompatRedirect />} />
              <Route path="*" element={<UnmigratedView />} />
            </Route>
          </Routes>
        </OpsRouteErrorBoundary>
      </div>
    </div>
  );
}
