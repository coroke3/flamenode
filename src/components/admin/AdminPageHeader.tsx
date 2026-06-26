import * as React from "react";
import {
  ConsolePageHeader,
  type ConsolePageHeaderAction,
  type ConsolePageHeaderProps,
} from "@/components/layout/ConsolePageHeader";

export type AdminPageHeaderAction = ConsolePageHeaderAction;

export type AdminPageHeaderProps = Pick<
  ConsolePageHeaderProps,
  "title" | "description" | "backHref" | "backLabel" | "actions"
>;

export function AdminPageHeader(
  props: AdminPageHeaderProps,
): React.ReactElement {
  return <ConsolePageHeader {...props} />;
}
