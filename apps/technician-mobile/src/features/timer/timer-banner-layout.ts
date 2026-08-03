export const MIN_CAMERA_CLEARANCE = 59;
export const TIMER_BANNER_VERTICAL_PADDING = 12;
export const TIMER_MESSAGE_VERTICAL_PADDING = 8;

export function topCutoutPadding(
  safeAreaTop: number,
  verticalPadding: number,
): number {
  return Math.max(safeAreaTop, MIN_CAMERA_CLEARANCE) + verticalPadding;
}
