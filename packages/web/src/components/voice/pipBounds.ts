import { layoutPixels, layoutRect, MOBILE_LAYOUT_BREAKPOINT } from '../../platform/interfaceScale';

/**
 * Where a floating window of the call may sit on the desktop: the call's own picture-in-picture
 * (`PictureInPicture`), and the video of watching together in its place (`WatchPlayerHost`).
 */

export const PIP_WIDTH = 320;
export const PIP_HEIGHT = 180;
export const PIP_MARGIN = 16;

/**
 * Computes PiP boundary box by measuring actual DOM obstacles.
 * Obstacle elements declare themselves with data-pip-obstacle="top"|"left"|"bottom".
 * PiP queries them at boundary-check time — no hardcoded layout values.
 *
 * On mobile (<768px) there are no fixed side/bottom UI obstacles.
 */
export function getPipBounds(pipX: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const vw = layoutPixels(window.innerWidth);
  const vh = layoutPixels(window.innerHeight);
  let minX = PIP_MARGIN;
  const maxX = vw - PIP_WIDTH - PIP_MARGIN;
  let minY = PIP_MARGIN;
  let maxY = vh - PIP_HEIGHT - PIP_MARGIN;

  if (vw < MOBILE_LAYOUT_BREAKPOINT) return { minX, maxX, minY, maxY };

  const obstacles = document.querySelectorAll<HTMLElement>('[data-pip-obstacle]');
  for (const el of obstacles) {
    const rect = layoutRect(el.getBoundingClientRect());
    if (rect.width === 0 || rect.height === 0) continue;

    const direction = el.dataset.pipObstacle;
    if (direction === 'top') {
      minY = Math.max(minY, rect.bottom + PIP_MARGIN);
    } else if (direction === 'left') {
      minX = Math.max(minX, rect.right + PIP_MARGIN);
    } else if (direction === 'bottom') {
      const pipRight = pipX + PIP_WIDTH;
      if (pipX < rect.right && pipRight > rect.left) {
        maxY = Math.min(maxY, rect.top - PIP_HEIGHT - PIP_MARGIN);
      }
    }
  }

  return { minX, maxX, minY, maxY };
}

/** Where a floating window first sits: bottom-right, above whatever bar lies under it. */
export function restingPipPosition(): { x: number; y: number } {
  const x = layoutPixels(window.innerWidth) - PIP_WIDTH - PIP_MARGIN;
  return { x, y: getPipBounds(x).maxY };
}
