"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";

export type ContextMenuAction =
  | "edit"
  | "copy"
  | "cut"
  | "paste"
  | "clear"
  | "fillDown"
  | "insertRow"
  | "duplicateRow"
  | "deleteRow";

export function SpreadsheetContextMenu({
  x,
  y,
  items,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  items: Array<{ id: ContextMenuAction; label: string; disabled?: boolean }>;
  onAction: (id: ContextMenuAction) => void;
  onClose: () => void;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={styles.ctxMenu}
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={styles.ctxMenuItem}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onAction(item.id);
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
