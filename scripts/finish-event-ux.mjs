import fs from "node:fs";

const requiredFiles = [
  "src/lib/actions/slot.ts",
  "src/lib/slots/slotReservationLimitGuard.ts",
  "src/components/event/SlotGrid.tsx",
  "src/components/admin/EventStaffManager.tsx",
  "src/components/admin/YoutubeDescriptionTemplateEditor.tsx",
  "migrations/0059_event_slot_reservation_limits.sql",
];

for (const path of requiredFiles) {
  if (!fs.existsSync(path)) {
    throw new Error(`required implementation file is missing: ${path}`);
  }
}

const slotAction = fs.readFileSync("src/lib/actions/slot.ts", "utf8");
if (!slotAction.includes("buildReservationLimitGuardStatement")) {
  throw new Error("remaining event UX implementation has not been applied");
}

console.log("finish-event-ux: implementation already applied; verification only");
