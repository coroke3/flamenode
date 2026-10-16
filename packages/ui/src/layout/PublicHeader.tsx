import React from "react";
import { Link } from "../adapters/index.js";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "../navigation/publicNavigation.js";
import { openDialogBehavior } from "../components/Dialog.js";

export interface PublicHeaderProps {
  currentPath?: string;
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function PublicHeader({
  currentPath,
  className,
}: PublicHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!mobileOpen) return;
    return openDialogBehavior(panelRef.current, triggerRef.current, () => () => setMobileOpen(false));
  }, [mobileOpen]);

  const toggleMobileNav = () => {
    setMobileOpen((prev) => !prev);
  };

  return (
    <header className={cx("fn-header", "fn-public-header", className)} lang="ja">
      <div className="fn-header-bar">
        <Link href="/" className="fn-header-logo" aria-label="FlameNode トップ">
          <span>FlameNode</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="fn-header-nav" aria-label="メインナビゲーション">
          {PUBLIC_NAV_ITEMS.map((item) => {
            const active = isPublicNavItemActive(currentPath ?? null, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx("fn-nav-item", active && "is-active")}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Header Right / Mobile Trigger */}
        <div className="fn-header-right">
          <button
            ref={triggerRef}
            type="button"
            className={cx("fn-burger-button", mobileOpen && "is-open")}
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-dialog"
            aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
            onClick={toggleMobileNav}
          >
            <span className="fn-burger-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer / Dialog */}
      {mobileOpen && (
        <div
          id="mobile-nav-dialog"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="メニュー"
          tabIndex={-1}
          className="fn-mobile-dialog"
        >
          <div className="fn-mobile-dialog-inner">
            <nav className="fn-mobile-nav" aria-label="メインナビゲーション">
              {PUBLIC_NAV_ITEMS.map((item) => {
                const active = isPublicNavItemActive(currentPath ?? null, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cx("fn-mobile-nav-item", active && "is-active")}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div
            className="fn-mobile-scrim"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}
    </header>
  );
}
