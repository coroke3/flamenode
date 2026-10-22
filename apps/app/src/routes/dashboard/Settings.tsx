import * as React from "react";
import type { PersonalApi } from "../../api/session.js";
import { useSearchParams } from "react-router-dom";
import { SessionGate } from "../guard.js";
import { settingsGateNext } from "../next.js";
import { PendingData } from "../pending.js";

/** CURRENT app/(auth)/dashboard/settings/page.tsx. Data: blocker B1. */
export function Settings({ api }: { api: PersonalApi }): React.ReactElement {
  const [params] = useSearchParams();
  return (
    <SessionGate api={api} next={settingsGateNext(params.get("next"))}>
      {() => <PendingData title="設定" endpoint="GET settings profile/X IDs" />}
    </SessionGate>
  );
}
