import * as React from "react";
import type { PersonalApi } from "../../api/session.js";
import { SessionGate } from "../guard.js";
import { PendingData } from "../pending.js";

/** CURRENT app/(auth)/dashboard/library/page.tsx. Data: blocker B1. */
export function Library({ api }: { api: PersonalApi }): React.ReactElement {
  return (
    <SessionGate api={api} next="/dashboard/library">
      {() => <PendingData title="ライブラリ" endpoint="GET library tabs" />}
    </SessionGate>
  );
}
