import "server-only";

import { and, eq } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import { getOnboardingState } from "@/lib/auth/onboarding";
import {
  canEditEventFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { withDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import { resolveReservationXIdentity } from "@/lib/slots/reservationIdentity";
import {
  canActAsSlotActor,
  resolveSlotViewerRelation,
} from "@/lib/slots/slotIdentityCore";
import { canUseSlotOperatorOverride } from "@/lib/slots/operatorReservationCore";
import {
  emptySlotViewerOverlay,
  type SlotViewerOverlayDto,
} from "@/lib/slots/slotViewerOverlayCore";

function userNeedsTermsAcceptance(user: {
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
}): boolean {
  return user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1;
}

/**
 * 枠ページのviewer依存情報だけを取得するprivate overlay。
 * 公開baseは現在のpage SSRがD1正本から取得するため、このoverlayでは
 * viewer所有権・本人向け表示・運営権限に必要な行だけ追加取得する。
 */
export async function loadSlotViewerOverlay(
  eventId: string,
): Promise<SlotViewerOverlayDto | null> {
  const eventRow = await withDatabase(async (db) =>
    (
      await db
        .select({
          id: eventsTable.id,
          start_time: eventsTable.start_time,
          end_time: eventsTable.end_time,
          entry_start_time: eventsTable.entry_start_time,
          entry_end_time: eventsTable.entry_end_time,
          slot_visibility_mode: eventsTable.slot_visibility_mode,
        })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.id, eventId),
            eq(eventsTable.visibility_status, "public"),
          )!,
        )
        .limit(1)
    )[0] ?? null,
  );

  if (!eventRow) return null;

  let viewer: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    viewer = await getCurrentUser();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CurrentUserUnavailableError) {
      return emptySlotViewerOverlay(true);
    }
    throw error;
  }

  if (!viewer) return emptySlotViewerOverlay(false);
  if (viewer.is_banned === 1) {
    return {
      ...emptySlotViewerOverlay(false),
      loggedIn: true,
      isBanned: true,
      needsTermsAcceptance: userNeedsTermsAcceptance(viewer),
    };
  }

  const unavailableForViewer = (): SlotViewerOverlayDto => ({
    ...emptySlotViewerOverlay(true),
    loggedIn: true,
    isBanned: false,
    needsTermsAcceptance: userNeedsTermsAcceptance(viewer),
  });

  try {
    const loaded = await withDatabase(async (db) => {
      const [onboarding, slotRows] = await Promise.all([
        getOnboardingState(db, viewer),
        db
          .select({
            id: slotsTable.id,
            status: slotsTable.status,
            display_name: slotsTable.display_name,
            x_user_id: slotsTable.x_user_id,
            reserved_x_id_snapshot: slotsTable.reserved_x_id_snapshot,
            reserved_by_user_id: slotsTable.reserved_by_user_id,
            reservation_group_id: slotsTable.reservation_group_id,
            creator_icon_url: videosTable.creator_icon_url,
          })
          .from(slotsTable)
          .leftJoin(videosTable, eq(slotsTable.video_id, videosTable.id))
          .where(
            and(
              eq(slotsTable.event_id, eventId),
              eq(slotsTable.reserved_by_user_id, viewer.id),
            )!,
          ),
      ]);

      const now = Math.floor(Date.now() / 1000);
      let operatorOverrideAllowed = false;
      if (
        viewer.role === "admin" ||
        onboarding.xIdentityStatus === "approved"
      ) {
        const authorization = await getManageAuthorizationSnapshot(
          viewer.id,
          viewer.role ?? null,
        );
        operatorOverrideAllowed =
          canEditEventFromSnapshot(authorization, eventId, "event.slots") &&
          onboarding.canReserveSlot &&
          canUseSlotOperatorOverride(eventRow, now);
      }

      let viewerXId: string | null = null;
      let viewerXIdNotice: string | null = null;
      if (onboarding.canReserveSlot) {
        const identity = await resolveReservationXIdentity(db, {
          user: { id: viewer.id },
          activeXId: viewer.active_x_user_id,
          approvedXIds: onboarding.activeApprovedXId
            ? [onboarding.activeApprovedXId]
            : [],
          hasPendingXRequest: onboarding.xIdentityStatus === "pending",
        });
        if (identity && "error" in identity) {
          viewerXIdNotice = identity.error;
        } else if (identity) {
          viewerXId = identity.snapshotXId;
        }
      }

      const groupKeys = new Map<string, string>();
      const slots = slotRows.map((slot) => {
        const viewerRelation = resolveSlotViewerRelation({
          reservedByUserId: slot.reserved_by_user_id,
          slotXUserId: slot.x_user_id,
          authUserId: viewer.id,
          activeXId: viewer.active_x_user_id ?? null,
        });
        const isOwnedByViewer = canActAsSlotActor(viewerRelation);
        const canReveal =
          viewerRelation === "active" ||
          viewerRelation === "unassigned" ||
          viewerRelation === "account_other" ||
          eventRow.slot_visibility_mode === "public_name";
        // public_nameではpage SSRのbase groupを正本にする。
        // anonymous/hiddenでは本人操作用にopaqueなgroup keyだけ補完する。
        const exposeViewerGroup =
          isOwnedByViewer && eventRow.slot_visibility_mode !== "public_name";
        let groupKey: string | null = null;
        if (exposeViewerGroup && slot.reservation_group_id) {
          groupKey = groupKeys.get(slot.reservation_group_id) ?? null;
          if (!groupKey) {
            groupKey = `viewer-group-${groupKeys.size + 1}`;
            groupKeys.set(slot.reservation_group_id, groupKey);
          }
        }

        return {
          id: slot.id,
          display_name: canReveal ? slot.display_name : null,
          reserved_x_id: canReveal
            ? (slot.reserved_x_id_snapshot ?? slot.x_user_id)
            : null,
          profile_x_user_id:
            canReveal && slot.x_user_id ? slot.x_user_id : null,
          submitted_icon_url:
            canReveal &&
            slot.status === "submitted" &&
            slot.creator_icon_url
              ? `/api/media/slot-submission-icon/${slot.id}`
              : null,
          is_owned_by_viewer: isOwnedByViewer,
          viewer_relation: viewerRelation,
          group_key: groupKey,
          x_user_id: isOwnedByViewer ? slot.x_user_id : null,
        };
      });

      return {
        loggedIn: true,
        authUnavailable: false,
        isBanned: false,
        needsTermsAcceptance: onboarding.needsTermsAcceptance,
        canReserveSlot: onboarding.canReserveSlot,
        canPost: onboarding.canPost,
        operatorOverrideAllowed,
        viewerXId,
        viewerXIdNotice,
        slots,
      } satisfies SlotViewerOverlayDto;
    });

    return loaded ?? unavailableForViewer();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[slot-viewer-overlay] viewer load failed", {
      eventId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return unavailableForViewer();
  }
}
