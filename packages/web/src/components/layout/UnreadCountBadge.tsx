import { CountBadge } from '../ui/CountBadge';

/**
 * The count of unread messages on a space or on Home: drawn for sight, while
 * `label` is read instead, so a screen reader hears "12 unread messages" rather
 * than "12". Above 99 it draws "99+". A muted space keeps its count in a quieter
 * colour (sounds.md, "Notification settings").
 *
 * `corner` sits on the corner of a tile (the phone's space strip); `inline`
 * runs in a line of text (the tabs of the top bar). The look is the shared
 * `CountBadge`, so every count in the app reads the same.
 */
export function UnreadCountBadge({ count, label, muted = false, placement = 'corner' }: {
  count: number;
  label: string;
  muted?: boolean;
  placement?: 'corner' | 'inline';
}) {
  return <CountBadge count={count} label={label} muted={muted} placement={placement} />;
}
