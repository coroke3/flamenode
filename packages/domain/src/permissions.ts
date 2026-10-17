export function canEditVideo(params: {
  isOwner: boolean;
  isCollabEditor: boolean;
  isEventStaff: boolean;
}): boolean {
  return params.isOwner || params.isCollabEditor || params.isEventStaff;
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "staff";
}
