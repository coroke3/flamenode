import React from "react";
import { SiteAdapterProvider } from "./SiteAdapterProvider.ts";

export interface StaticScreenProps<P extends object> {
  screen: React.ComponentType<P>;
  props: P;
}

/**
 * Server-only render of a shared `@flamenode/ui` screen inside the site
 * adapters (MIG-0402 Context), for `.astro` pages without a `client:*`
 * directive: the HTML is static and ships no JavaScript. The provider and the
 * screen are composed here, in one React tree, because children written in a
 * `.astro` file become a separate static slot that would not see the provider.
 * Interactive parts are separate Islands (MIG-0502 / MIG-0504 / MIG-0507).
 */
export function StaticScreen<P extends object>({ screen, props }: StaticScreenProps<P>): React.ReactElement {
  return React.createElement(SiteAdapterProvider, null, React.createElement(screen, props));
}

export default StaticScreen;
