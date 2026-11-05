/**
 * The class strings the phone's screens share, so that a bar, a sheet or a
 * panel cannot drift away from its siblings. Each builds on a component class
 * from globals.css and sets what the phone needs differently: a 40px touch size.
 */

/** A button in a phone's bar: the shared icon button at the touch size. */
export const BAR_BUTTON = 'icon-btn h-10 w-10 text-txt-secondary';

/** The same button where the bar lies over a picture (a space's banner): drawn in the primary colour. */
export const BAR_BUTTON_ON_PICTURE = 'icon-btn h-10 w-10 text-txt-primary';

/** The title in a phone's bar, set like a dialog's. */
export const BAR_TITLE = 'min-w-0 flex-1 truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary';

/** The grab handle on top of a bottom sheet. */
export const SHEET_HANDLE = 'mx-auto mb-1 mt-2 h-1 w-10 rounded-sm bg-txt-tertiary/30';

/** A row of a bottom sheet: full width, at least 44px tall. */
export const SHEET_ROW = 'list-row min-h-11 w-full rounded-none px-5 py-2.5 text-body';

/**
 * The body of a pushed settings screen. It sits on the page's surface, as a
 * panel does on the desktop, and the panel's own title is hidden, because the
 * bar above already names the screen; what followed the title then starts at
 * the top of the body. Not every panel has moved to `.page-title` yet, hence
 * the selectors for a plain heading at the head of a panel.
 */
export const PANEL_BODY = 'flex-1 overflow-y-auto bg-surface-chat p-4 '
  + '[&_.page-title]:hidden [&_.page-title+*]:!mt-0 [&_div:has(>.page-title:only-child)+*]:!mt-0 '
  + '[&>div>h2:first-child]:hidden [&>div>h2:first-child+*]:!mt-0';
