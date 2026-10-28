// MIG-0701 U04b (D-13-5): keep prefixed CSS derived from CURRENT modules.
import fs from "node:fs";

export const MODULES = [
  ["dash", "app/(auth)/dashboard/page.module.css", "apps/app/src/styles/dashboard.css"],
  ["onb", "app/(auth)/onboarding/page.module.css", "apps/app/src/styles/onboarding.css"],
  ["settings", "src/components/settings/settings-page.module.css", "apps/app/src/styles/settings.css"],
  ["vcard", "src/components/video/VideoCard.module.css", "apps/app/src/styles/video-card.css"],
  ["ydesc", "src/components/forms/YoutubeDescriptionPreview.module.css", "apps/app/src/styles/forms-a.css"],
  ["cq", "src/components/forms/CustomQuestionFields.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-badge", "src/components/video/permission/PermissionBadge.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-lock", "src/components/video/permission/FieldLockNote.module.css", "apps/app/src/styles/forms-a.css"],
  ["perm-label", "src/components/video/permission/PermissionFieldLabel.module.css", "apps/app/src/styles/forms-a.css"],
  ["social", "src/components/forms/SocialLinksEditor.module.css", "apps/app/src/styles/shared-social.css"],
  ["ychan", "src/components/settings/YoutubeChannelPicker.module.css", "apps/app/src/styles/shared-social.css"],
  ["cdlg", "src/components/ui/ConfirmDialog.module.css", "apps/app/src/styles/shared-social.css"],
];
export function portCssModule(css, prefix) {
  const parts = css.split(/([{}])/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (parts[i + 1] === "{" && !part.trim().startsWith("@")) {
      out += part.replace(/:global\(([^)]*)\)|\.(-?[A-Za-z_][\w-]*)/g, (m, g, cls) => (g !== undefined ? g : "." + prefix + "-" + cls));
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
