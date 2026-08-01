"use client";

import * as React from "react";
import styles from "./SocialLinksEditor.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  parseSocialLinks,
  SOCIAL_LINK_TYPE_OPTIONS,
  type SocialLink,
} from "@/lib/socialLinks";

function emptySocialLink(): SocialLink {
  return { type: "X", url: "" };
}

function draftSocialLinksJson(links: readonly SocialLink[]): string {
  const rows = links
    .map((link) => ({
      type: link.type.trim() || "Other",
      url: link.url.trim(),
    }))
    .filter((link) => link.url.length > 0);
  return rows.length > 0 ? JSON.stringify(rows) : "";
}

export function SocialLinksEditor({
  initialValue,
  disabled = false,
  label = "SNS / 外部リンク",
  onValueChange,
}: {
  initialValue: string | null;
  disabled?: boolean;
  label?: string;
  onValueChange?: (json: string) => void;
}): React.ReactElement {
  const [links, setLinks] = React.useState<SocialLink[]>(() => {
    const parsed = parseSocialLinks(initialValue);
    return parsed.length > 0 ? parsed : [emptySocialLink()];
  });
  const hiddenValue = React.useMemo(() => draftSocialLinksJson(links), [links]);

  React.useEffect(() => {
    onValueChange?.(hiddenValue);
  }, [hiddenValue, onValueChange]);

  const updateLink = (index: number, patch: Partial<SocialLink>) => {
    setLinks((current) =>
      current.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  };

  const removeLink = (index: number) => {
    setLinks((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [emptySocialLink()];
    });
  };

  return (
    <div className={styles.root}>
      <input type="hidden" name="other_social_links" value={hiddenValue} />
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setLinks((current) => [...current, emptySocialLink()])}
          disabled={disabled || links.length >= 8}
        >
          <Icon name="plus" size={12} aria-hidden />
          追加
        </button>
      </div>
      <div className={styles.rows}>
        {links.map((link, index) => (
          <div className={styles.row} key={`${index}-${link.type}`}>
            <label className="fn-sr-only" htmlFor={`social-type-${index}`}>
              SNS種類
            </label>
            <select
              id={`social-type-${index}`}
              className={styles.select}
              value={link.type}
              onChange={(ev) => updateLink(index, { type: ev.currentTarget.value })}
              disabled={disabled}
            >
              {(
                (SOCIAL_LINK_TYPE_OPTIONS as readonly string[]).includes(link.type)
                  ? SOCIAL_LINK_TYPE_OPTIONS
                  : ([link.type, ...SOCIAL_LINK_TYPE_OPTIONS] as const)
              ).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label className="fn-sr-only" htmlFor={`social-url-${index}`}>
              SNS URL
            </label>
            <input
              id={`social-url-${index}`}
              type="text"
              inputMode="url"
              className={styles.input}
              value={link.url}
              placeholder="https://... または mailto:you@example.com"
              maxLength={500}
              onChange={(ev) => updateLink(index, { url: ev.currentTarget.value })}
              disabled={disabled}
            />
            <button
              type="button"
              className={styles.iconOnlyButton}
              onClick={() => removeLink(index)}
              disabled={disabled}
              aria-label="SNSリンクを削除"
              title="SNSリンクを削除"
            >
              <Icon name="trash" size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
