// MIG-0707 U05c: generate one scoped CSS file from three CURRENT CSS modules.
import fs from "node:fs";
import { portCssModule } from "../../app/scripts/portCssModule.mjs";
export { portCssModule } from "../../app/scripts/portCssModule.mjs";

export const MODULES = [
  ["empty", "src/components/ui/EmptyState.module.css", "apps/ops/src/styles/shared.css"],
  ["confirm", "src/components/ui/ConfirmDialog.module.css", "apps/ops/src/styles/shared.css"],
  ["sectabs", "src/components/admin/AdminSectionTabs.module.css", "apps/ops/src/styles/shared.css"],
  ["adminnav", "src/components/admin/AdminSidebarNav.module.css", "apps/ops/src/styles/manage-shell.css"],
  ["costguard", "src/components/layout/CostGuardBanner.module.css", "apps/ops/src/styles/manage-shell.css"],
];
const root = new URL("../../../", import.meta.url);

export function buildSharedCss() {
  return MODULES.filter(([, , target]) => target === "apps/ops/src/styles/shared.css").map(([prefix, from]) => {
    const source = fs.readFileSync(new URL(from, root), "utf8");
    return `/* Generated from CURRENT ${from}; prefix=${prefix}. */\n${portCssModule(source, prefix).trimEnd()}`;
  }).join("\n\n") + "\n";
}

export function buildManageCss() {
  return MODULES.filter(([, , target]) => target === "apps/ops/src/styles/manage-shell.css").map(([prefix, from]) => {
    const source = fs.readFileSync(new URL(from, root), "utf8");
    return `/* Generated from CURRENT ${from}; prefix=${prefix}. */\n${portCssModule(source, prefix).trimEnd()}`;
  }).join("\n\n") + "\n";
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  fs.writeFileSync(new URL("apps/ops/src/styles/shared.css", root), buildSharedCss());
  fs.writeFileSync(new URL("apps/ops/src/styles/manage-shell.css", root), buildManageCss());
}
