import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { TableScroll } from "@/components/ui/TableScroll";

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
