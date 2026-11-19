/**
 * MIG-0603 U02a: unmounted Hono manage-video status access adapter.
 * All Drizzle/schema/permission queries live in server-core, not apps/api
 * routes. The eventual HTTP handler still MUST enforce Origin -> Session ->
 * writeGuard(requiredRole:null) -> CostGuard("manage_video_status") before
 * invoking this preflight; this file does not enable a public endpoint.
 */
export {
  checkManageVideoStatusAccess,
  type ManageVideoStatusAccess,
  loadManageVideoStatusSnapshot,
  type ManageVideoStatusSnapshot,
} from "@flamenode/server-core/video/manageStatusAccess";
