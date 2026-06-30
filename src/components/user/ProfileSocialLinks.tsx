import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import {
  formatSocialLinkLabel,
  profileHeaderSocialLinks,
  socialLinkIconName,
  type SocialLink,
} from "@/lib/socialLinks";
import { formatYoutubeChannelLabel } from "@/lib/utils/youtubeChannel";

interface ProfileSocialLinksProps {
  xUserId: string;
  youtubeChannelUrl?: string | null;
  socialLinks?: readonly SocialLink[];
  className?: string;
}

export function ProfileSocialLinks({
  xUserId,
  youtubeChannelUrl,
  socialLinks = [],
  className,
}: ProfileSocialLinksProps): React.ReactElement {
  const headerLinks = profileHeaderSocialLinks(socialLinks, xUserId);

  return (
    <div className={className}>
      <a href={`https://x.com/${xUserId}`} target="_blank" rel="noopener noreferrer">
        <Icon name="x" size={12} aria-hidden />
        @{xUserId}
      </a>
      {youtubeChannelUrl ? (
        <a href={youtubeChannelUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="youtube" size={12} aria-hidden />
          {formatYoutubeChannelLabel(youtubeChannelUrl)}
        </a>
      ) : null}
      {headerLinks.map((link) => {
        const external = !link.url.startsWith("mailto:");
        return (
          <a
            key={`${link.type}-${link.url}`}
            href={link.url}
            {...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            <Icon name={socialLinkIconName(link.type)} size={12} aria-hidden />
            {formatSocialLinkLabel(link.type, link.url)}
          </a>
        );
      })}
    </div>
  );
}
