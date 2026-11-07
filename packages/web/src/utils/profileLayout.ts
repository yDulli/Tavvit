import { isProfileLayout, type ProfileLayout } from '@backspace/shared';

// How a profile's chosen layout (`User.profileLayout`) arranges the top of
// its card. The card, the full profile and the editor's preview read the same
// table, so the preview shows what everyone else will see.

/** Where a profile is drawn: the card, the full profile, the editor's preview. */
export type ProfileSurface = 'card' | 'full' | 'preview';

export interface ProfileHeaderLook {
  /** Height class of the banner; null when the layout has no banner area. */
  banner: string | null;
  /**
   * How tall the profile's effect is, in pixels (docs/systems/decorations.md): the banner's height,
   * and on a layout without one the same height across the top of the card.
   */
  effectHeight: number;
  avatarSize: number;
  /** Places the picture: over the banner's edge, or in the header's row. */
  avatar: string;
  /** Arranges the picture and the name block. */
  header: string;
}

const LOOKS: Record<ProfileSurface, Record<ProfileLayout, ProfileHeaderLook>> = {
  card: {
    standard: { banner: 'h-[96px]', effectHeight: 96, avatarSize: 80, avatar: 'mt-[-48px] mb-3', header: '' },
    centered: { banner: 'h-[96px]', effectHeight: 96, avatarSize: 80, avatar: 'mt-[-48px] mb-3', header: 'flex flex-col items-center text-center' },
    compact: { banner: null, effectHeight: 96, avatarSize: 56, avatar: 'flex-shrink-0', header: 'flex items-center gap-3 pt-4' },
  },
  full: {
    standard: { banner: 'h-[120px]', effectHeight: 120, avatarSize: 96, avatar: 'mt-[-56px] mb-2', header: '' },
    centered: { banner: 'h-[120px]', effectHeight: 120, avatarSize: 96, avatar: 'mt-[-56px] mb-2', header: 'flex flex-col items-center text-center' },
    compact: { banner: null, effectHeight: 120, avatarSize: 64, avatar: 'flex-shrink-0', header: 'flex items-center gap-4 pt-6 mb-3' },
  },
  preview: {
    standard: { banner: 'h-[80px]', effectHeight: 80, avatarSize: 56, avatar: 'mt-[-32px] mb-2', header: '' },
    centered: { banner: 'h-[80px]', effectHeight: 80, avatarSize: 56, avatar: 'mt-[-32px] mb-2', header: 'flex flex-col items-center text-center' },
    compact: { banner: null, effectHeight: 80, avatarSize: 44, avatar: 'flex-shrink-0', header: 'flex items-center gap-3 pt-3 mb-1' },
  },
};

/** A profile's layout; anything a host sends that this client does not know is the standard one. */
export function profileLayoutOf(profile: { profileLayout?: string | null }): ProfileLayout {
  return isProfileLayout(profile.profileLayout) ? profile.profileLayout : 'standard';
}

export function profileHeaderLook(layout: ProfileLayout, surface: ProfileSurface): ProfileHeaderLook {
  return LOOKS[surface][layout];
}
