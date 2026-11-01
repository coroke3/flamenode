import * as React from "react";
import { Route, Routes } from "react-router-dom";
import type { OpsApi } from "../api/account.js";
import { AuthErrorView, OpsGate } from "./guard.js";

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
export function OpsRoutes({ api }: { api: OpsApi }): React.ReactElement {
  const manage = <OpsGate surface="manage" api={api}><UnmigratedView /></OpsGate>;
  const admin = <OpsGate surface="admin" api={api}><UnmigratedView /></OpsGate>;
  return (
    <div data-fn-surface="ops" className="fn-app">
      <main className="fn-main flex-1 w-full">
        <OpsRouteErrorBoundary>
          <Routes>
            <Route path="/manage" element={manage} />
            <Route path="/manage/*" element={manage} />
            <Route path="/admin" element={admin} />
            <Route path="/admin/*" element={admin} />
          </Routes>
        </OpsRouteErrorBoundary>
      </main>
    </div>
  );
}
