import * as React from "react";
import {
  ConsolePageHeader,
  type ConsolePageHeaderAction,
  type ConsolePageHeaderProps,
} from "@/components/layout/ConsolePageHeader";

export type ManagePageHeaderAction = ConsolePageHeaderAction;

export type ManagePageHeaderProps = Pick<
  ConsolePageHeaderProps,
  | "title"
  | "description"
  | "backHref"
  | "backLabel"
  | "actions"
  | "accent"
  | "children"
>;

export function ManagePageHeader(
  props: ManagePageHeaderProps,
): React.ReactElement {
  return <ConsolePageHeader {...props} />;
}
