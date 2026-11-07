/**
 * Whether a list of messages was scrolled just now (MessageList notes every scroll the person makes).
 * A row takes no hover while it was: a row passing under a still pointer would otherwise measure
 * itself, render its hover bar and start its author's decorations on every frame of the scroll.
 * Kept here rather than as an attribute on the list, as switching an attribute that every row's
 * style reads made the browser work out the style of all of them again at each start and end of a
 * scroll.
 */
let settlesAt = 0;
const SETTLE_MS = 150;

export function noteListScroll(now: number = performance.now()): void {
  settlesAt = now + SETTLE_MS;
}

export function listScrolledJustNow(now: number = performance.now()): boolean {
  return now < settlesAt;
}
