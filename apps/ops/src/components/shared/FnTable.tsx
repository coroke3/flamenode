// Port of CURRENT src/components/ui/FnTable.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";
import { cn } from "./cn.js";
import { TableScroll } from "./TableScroll.js";

/**
 * 管理・運営向けの横スクロール対応テーブル。
 * `fn-table` + `TableScroll` をまとめたラッパ。
 */
export function FnTable({
  className,
  children,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>): React.ReactElement {
  return (
    <TableScroll>
      <table className={cn("fn-table", className)} {...rest}>
        {children}
      </table>
    </TableScroll>
  );
}
