// MIG-0707 U05c: generate one scoped CSS file from three CURRENT CSS modules.
import fs from "node:fs";
import { portCssModule } from "../../app/scripts/portCssModule.mjs";
export { portCssModule } from "../../app/scripts/portCssModule.mjs";

export const MODULES = [
  ["empty", "src/components/ui/EmptyState.module.css", "apps/ops/src/styles/shared.css"],
  ["confirm", "src/components/ui/ConfirmDialog.module.css", "apps/ops/src/styles/shared.css"],
  ["sectabs", "src/components/admin/AdminSectionTabs.module.css", "apps/ops/src/styles/shared.css"],
];
const root = new URL("../../../", import.meta.url);

export function buildSharedCss() {
  const generated = MODULES.map(([prefix, from]) => {
    const source = fs.readFileSync(new URL(from, root), "utf8");
    return `/* Generated from CURRENT ${from}; prefix=${prefix}. */\n${portCssModule(source, prefix).trimEnd()}`;
  }).join("\n\n") + "\n";
  // Keep generated CSS byte-stable while bundling the hand-written review stylesheet.
  return "/* MIG-0724: Ops shared CSS loads video-review styling without Node.js ESM CSS imports. */\n@import \"./video-review.css\";\n\n" + generated;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  fs.writeFileSync(new URL("apps/ops/src/styles/shared.css", root), buildSharedCss());
}
