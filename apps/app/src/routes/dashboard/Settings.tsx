import * as React from "react";
import type { PersonalApi } from "../../api/session.js";
import { SessionGate } from "../guard.js";
import { PendingData } from "../pending.js";

/** CURRENT app/(auth)/dashboard/settings/page.tsx. Data: blocker B1. */
export function Settings({ api }: { api: PersonalApi }): React.ReactElement {
  return (
    <SessionGate api={api} next="/dashboard/settings">
      {() => <PendingData title="設定" endpoint="GET settings profile/X IDs" />}
    </SessionGate>
  );
}
