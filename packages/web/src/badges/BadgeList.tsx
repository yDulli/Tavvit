import { orderedBadges, type BadgeId } from '@backspace/shared/src/badges';
import type { MemberWithUser, Space, User } from '@backspace/shared';
import { useCallback, useRef, useState } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { BadgeCard } from './BadgeCard';
import { BadgeGlyph } from './BadgeGlyph';
import { useBadgeText } from './badgeText';

/** The size of a mark by a name; its cell in the strip adds 3px around it (globals.css `.badge-mark`). */
const SIZES = { 'sm': 16, 'md': 18, 'lg': 20 } as const;

/** One badge: its name on the pointer, and when clicked what it means. */
function BadgeMark({ id, size, name, description, category }: { id: BadgeId; size: number; name: string; description: string; category: string }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = (event: React.SyntheticEvent) => {
    // A badge often sits on something that opens when clicked: a card, a space's header.
    event.preventDefault();
    event.stopPropagation();
    setOpen((was) => !was);
  };
  const mark = (
    // A span and not a button: it can sit inside a button, which a button cannot.
    <span
      ref={anchorRef}
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggle(event); }}
      className="badge-mark"
    >
      <BadgeGlyph id={id} size={size} />
    </span>
  );
  return (
    <span role="listitem" className="inline-flex">
      <Tooltip content={name} position="top" disabled={open}>{mark}</Tooltip>
      {open && <BadgeCard id={id} name={name} description={description} category={category} anchorRef={anchorRef} onClose={close} />}
    </span>
  );
}

/**
 * Badges in a strip on the sheet's dark ground, in their fixed order. Each says its name on the
 * pointer, and when clicked opens a small card saying what it means, also on a touch screen,
 * which shows no tooltips. `max` keeps a busy strip short; what it leaves out is counted. `notes`
 * adds a word to a badge's name, such as the owner title.
 */
export function BadgeList({ badges, size = 'sm', max, notes }: {
  badges: readonly BadgeId[];
  size?: keyof typeof SIZES;
  max?: number;
  notes?: Partial<Record<BadgeId, string>>;
}) {
  const text = useBadgeText();
  const ordered = orderedBadges(badges);
  if (ordered.length === 0) return null;
  const shown = max !== undefined ? ordered.slice(0, max) : ordered;
  const hidden = ordered.length - shown.length;
  return (
    <span role="list" className="badge-strip flex-shrink-0">
      {shown.map((id) => {
        const note = notes?.[id];
        return (
          <BadgeMark
            key={id}
            id={id}
            size={SIZES[size]}
            name={note ? `${text[id].name} · ${note}` : text[id].name}
            description={text[id].description}
            category={text[id].category}
          />
        );
      })}
      {hidden > 0 && <span aria-hidden="true" className="px-1 font-mono text-2xs leading-none text-txt-tertiary">+{hidden}</span>}
    </span>
  );
}

/**
 * Every badge a person shows inside a space: their own (staff, those an
 * admin gave them), the space ones the server worked out from their roles,
 * and owning the space, which comes from the space's owner id and never
 * from a role (docs/systems/badges.md).
 */
export function memberBadgeIds(
  member: Pick<MemberWithUser, 'userId' | 'badges'> & { user: Pick<User, 'badges'> },
  space: Pick<Space, 'ownerId'> | undefined,
): BadgeId[] {
  const ids: BadgeId[] = [...(member.user.badges ?? []), ...(member.badges ?? [])];
  // The owner outranks every role, so their roles add no staff badge beside the crown.
  if (space && member.userId === space.ownerId) {
    return orderedBadges([...ids.filter((id) => id !== 'administrator' && id !== 'moderator'), 'server_owner']);
  }
  return orderedBadges(ids);
}
