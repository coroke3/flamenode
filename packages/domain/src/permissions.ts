export function canEditVideo(params: {
  isOwner: boolean;
  isCollabEditor: boolean;
  isEventStaff: boolean;
}): boolean {
  return params.isOwner || params.isCollabEditor || params.isEventStaff;
}
