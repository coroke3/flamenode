import * as React from "react";
import type { OpsApi } from "../../api/account.js";
import { ConsoleShell } from "../../components/shared/ConsoleShell.js";
import { OpsGate } from "../guard.js";
import { AdminSidebar } from "./AdminSidebarNav.js";

/**
 * Admin parity shell. The caller supplies shared header/footer and the admin
 * cost banner; MIG-0719 owns their shared implementation and MIG-0661 its DTO.
 * Never render this frame outside OpsGate: no client gate replaces API authz.
 */
export function AdminLayoutFrame({
  children, banner, header, footer, enableSpreadsheet = false,
}: {
  children: React.ReactNode;
  banner: React.ReactNode;
  header: React.ReactNode;
  footer: React.ReactNode;
  enableSpreadsheet?: boolean;
}): React.ReactElement {
  return (
    <div data-admin-shell="" data-fn-surface="admin">
      {banner}
      {header}
      <ConsoleShell consoleMode="admin" navigation={<AdminSidebar enableSpreadsheet={enableSpreadsheet} />}>
        <main className="admin-main">{children}</main>
      </ConsoleShell>
      {footer}
    </div>
  );
}

/** No Admin UI content is mounted until a fresh admin-only RH-001 gate allows it. */
export function AdminLayout({
  api, children, banner, header, footer, enableSpreadsheet = false,
}: React.ComponentProps<typeof AdminLayoutFrame> & { api: OpsApi }): React.ReactElement {
  return (
    <OpsGate surface="admin" api={api}>
      <AdminLayoutFrame
        banner={banner} header={header} footer={footer}
        enableSpreadsheet={enableSpreadsheet}
      >
        {children}
      </AdminLayoutFrame>
    </OpsGate>
  );
}
