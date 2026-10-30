import * as React from "react";
import { Route, Routes } from "react-router-dom";
import type { OpsApi } from "../api/account.js";
import { AuthErrorView, OpsGate } from "./guard.js";
import { ManageLayout } from "./manage/ManageLayout.js";
import { ManageDashboard } from "./manage/ManageDashboard.js";
import { ManageReviewRedirect } from "./manage/ManageReviewRedirect.js";

/** Future MIG-0720..0725 and MIG-0726 admin screens retain an explicit placeholder. */
function UnmigratedView(): React.ReactElement {
  return <section aria-label="運営コンソール">移行準備中</section>;
}
export class OpsRouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <AuthErrorView error={this.state.error} reset={() => this.setState({ error: null })} />;
  }
}
export function OpsRoutes({ api }: { api: OpsApi }): React.ReactElement {
  return <div data-fn-surface="ops" className="fn-app">
    <div className="fn-main flex-1 w-full">
      <OpsRouteErrorBoundary>
        <Routes>
          <Route path="/manage/*" element={
            <OpsGate surface="manage" api={api}><ManageLayout><Routes>
              <Route index element={<ManageDashboard />} />
              <Route path="events/:id/review" element={<ManageReviewRedirect />} />
              <Route path="*" element={<UnmigratedView />} />
            </Routes></ManageLayout></OpsGate>
          } />
          <Route path="/admin" element={<OpsGate surface="admin" api={api}><UnmigratedView /></OpsGate>} />
          <Route path="/admin/*" element={<OpsGate surface="admin" api={api}><UnmigratedView /></OpsGate>} />
        </Routes>
      </OpsRouteErrorBoundary>
    </div>
  </div>;
}
