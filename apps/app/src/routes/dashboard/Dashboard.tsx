import * as React from "react";
import type { PersonalApi } from "../../api/session.js";
import { SessionGate } from "../guard.js";
import { PendingData } from "../pending.js";

/** CURRENT app/(auth)/dashboard/page.tsx (next="/dashboard"). Data: blocker B1. */
export function Dashboard({ api }: { api: PersonalApi }): React.ReactElement {
  return (
    <SessionGate api={api} next="/dashboard">
      {() => <PendingData title="ダッシュボード" endpoint="GET dashboard overview" />}
    </SessionGate>
  );
}
