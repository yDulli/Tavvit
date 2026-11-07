import type { BadgeId } from '@backspace/shared/src/badges';
import administrator from './images/administrator.webp';
import beta_tester from './images/beta_tester.webp';
import bot from './images/bot.webp';
import bug_hunter from './images/bug_hunter.webp';
import community_contributor from './images/community_contributor.webp';
import creator from './images/creator.webp';
import developer from './images/developer.webp';
import early_supporter from './images/early_supporter.webp';
import event_participant from './images/event_participant.webp';
import founder from './images/founder.webp';
import helper from './images/helper.webp';
import moderator from './images/moderator.webp';
import partner from './images/partner.webp';
import server_owner from './images/server_owner.webp';
import staff from './images/staff.webp';
import verified from './images/verified.webp';

/**
 * The badge pictures (docs/systems/badges.md): matte metal marks cut from the badge sheet in
 * assets/brand by `scripts/badges/cut.mjs`, which also says which mark of the sheet each badge
 * is. They lie flat on the surface: no glow, no light behind them. Each is 72px, so it stays
 * sharp from 14px next to a name to 24px on a badge's card.
 */
const PICTURES: Record<BadgeId, string> = {
  staff,
  bot,
  server_owner,
  administrator,
  moderator,
  helper,
  founder,
  early_supporter,
  bug_hunter,
  developer,
  creator,
  event_participant,
  community_contributor,
  beta_tester,
  verified,
  partner,
};

/** A badge's picture. It says nothing itself: what holds it carries the badge's name. */
export function BadgeGlyph({ id, size }: { id: BadgeId; size: number }) {
  return (
    <img
      src={PICTURES[id]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className="flex-shrink-0 select-none"
    />
  );
}
