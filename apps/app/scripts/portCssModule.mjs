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
  ["vedit-overview", "src/components/video/permission/VideoEditPermissionOverview.module.css", "apps/app/src/styles/video-edit-permission-overview.css"],
  ["empty-state", "src/components/ui/EmptyState.module.css", "apps/app/src/styles/empty-state.css"],
];

export function portCssModule(css, prefix) {
  const parts = css.split(/([{}])/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (parts[i + 1] === "{" && !part.trim().startsWith("@")) {
      // Token and balanced-span loops share this cursor to preserve nested, quoted and commented global delimiters.
      const tokens = /:global\(|\.(-?[A-Za-z_][\w-]*)/g;
      let cursor = 0, match;
      while ((match = tokens.exec(part))) {
        out += part.slice(cursor, match.index);
        if (match[1] !== undefined) {
          out += "." + prefix + "-" + match[1];
          cursor = tokens.lastIndex;
          continue;
        }
        const start = tokens.lastIndex;
        let end = start, depth = 1, quote = "", comment = false;
        for (; end < part.length; end++) {
          const char = part[end];
          if (comment) {
            if (char === "*" && part[end + 1] === "/") { comment = false; end++; }
            continue;
          }
          if (char === "\\") { end++; continue; }
          if (quote) {
            if (char === quote) quote = "";
          } else if (char === "/" && part[end + 1] === "*") {
            comment = true; end++;
          } else if (char === '"' || char === "'") quote = char;
          else if (char === "(") depth++;
          else if (char === ")" && --depth === 0) break;
        }
        if (depth !== 0) throw new SyntaxError("Unclosed :global() CSS selector");
        out += part.slice(start, end);
        cursor = tokens.lastIndex = end + 1;
      }
      out += part.slice(cursor);
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
