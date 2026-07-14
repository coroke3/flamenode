import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

type AdminResourceTab<Key extends string> = {
  key: Key;
  href: string;
  label: string;
  icon: IconName;
};

export function AdminResourceTabs<Key extends string>({
  tabs,
  active,
  ariaLabel,
  className = "fn-console-resource-tabs",
}: {
  tabs: readonly AdminResourceTab<Key>[];
  active?: Key;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav className={className} aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`fn-btn fn-btn-sm ${isActive ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={tab.icon} size={11} aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
