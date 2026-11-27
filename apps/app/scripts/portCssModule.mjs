// MIG-0701 U04b (D-13-5): keep prefixed CSS derived from CURRENT modules.
import fs from "node:fs";

export const MODULES = [
  ["dash", "app/(auth)/dashboard/page.module.css", "apps/app/src/styles/dashboard.css"],
  ["cgb", "src/components/layout/CostGuardBanner.module.css", "apps/app/src/styles/cost-guard-banner.css"],
  ["onb", "app/(auth)/onboarding/page.module.css", "apps/app/src/styles/onboarding.css"],
  ["entry", "app/(auth)/entry/page.module.css", "apps/app/src/styles/entry.css"],
  ["settings", "src/components/settings/settings-page.module.css", "apps/app/src/styles/settings.css"],
  ["xids", "src/components/settings/XIdSettingsClient.module.css", "apps/app/src/styles/xid-settings.css"],
  ["vcard", "src/components/video/VideoCard.module.css", "apps/app/src/styles/video-card.css"],
  ["vmembers", "src/components/forms/VideoMembersField.module.css", "apps/app/src/styles/video-members.css"],
  ["ydesc", "src/components/forms/YoutubeDescriptionPreview.module.css", "apps/app/src/styles/forms-a.css"],
  ["cq", "src/components/forms/CustomQuestionFields.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-badge", "src/components/video/permission/PermissionBadge.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-lock", "src/components/video/permission/FieldLockNote.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-label", "src/components/video/permission/PermissionFieldLabel.module.css", "apps/app/src/styles/forms-a.css"],
  ["social", "src/components/forms/SocialLinksEditor.module.css", "apps/app/src/styles/shared-social.css"],
  ["ychan", "src/components/settings/YoutubeChannelPicker.module.css", "apps/app/src/styles/shared-social.css"],
  ["cdlg", "src/components/ui/ConfirmDialog.module.css", "apps/app/src/styles/shared-social.css"],
  ["sqicon", "src/components/media/SquareIconEditor.module.css", "apps/app/src/styles/shared-social.css"],
  ["vform", "src/components/forms/VideoForm.module.css", "apps/app/src/styles/video-form.css"],
];
function prefixLocalClasses(selector, prefix) {
  return selector.replace(/\.(-?[A-Za-z_][\w-]*)/g, (_match, name) => "." + prefix + "-" + name);
}

function findGlobalEnd(selector, start) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let i = start; i < selector.length; i++) {
    const ch = selector[i], next = selector[i + 1];
    if (comment) {
      if (ch === "*" && next === "/") { comment = false; i++; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "/" && next === "*") { comment = true; i++; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  throw new SyntaxError("Unclosed :global(...) in CSS selector");
}

function transformSelector(selector, prefix) {
  let out = "";
  let cursor = 0;
  while (true) {
    const start = selector.indexOf(":global(", cursor);
    if (start < 0) return out + prefixLocalClasses(selector.slice(cursor), prefix);
    out += prefixLocalClasses(selector.slice(cursor, start), prefix);
    const innerStart = start + ":global(".length;
    const end = findGlobalEnd(selector, innerStart);
    out += selector.slice(innerStart, end);
    cursor = end + 1;
  }
}

export function portCssModule(css, prefix) {
  const parts = css.split(/([{}])/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (parts[i + 1] === "{" && !part.trim().startsWith("@")) {
      out += transformSelector(part, prefix);
    } else out += part;
  }
  return out;
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const root = new URL("../../../", import.meta.url);
  const byTarget = new Map();
  for (const [prefix, from, to] of MODULES) {
    const chunks = byTarget.get(to) ?? [];
    chunks.push(portCssModule(fs.readFileSync(new URL(from, root), "utf8"), prefix));
    byTarget.set(to, chunks);
  }
  // Multiple current CSS modules can share forms-a.css: never overwrite an earlier module.
  for (const [to, chunks] of byTarget) {
    fs.writeFileSync(new URL(to, root), chunks.join("\n"));
  }
}
