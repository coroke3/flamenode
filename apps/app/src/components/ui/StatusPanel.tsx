// MIG-0716 U01a: exact CURRENT StatusPanel markup with derived global classes; used by both entry presenters.
import * as React from "react";


type StatusPanelProps = {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
};

export function StatusPanel({
  title,
  children,
  action,
  tone = "info",
}: StatusPanelProps): React.ReactElement {
  return (
    <section className={`status-panel-panel status-panel-${tone}`}>
      <div className="status-panel-text">
        <h2>{title}</h2>
        {children ? <div className="status-panel-body">{children}</div> : null}
      </div>
      {action ? <div className="status-panel-action">{action}</div> : null}
    </section>
  );
}
