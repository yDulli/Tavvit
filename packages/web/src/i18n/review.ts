import type {
  DiscoveryStatus,
  ReviewAction,
  SpaceCategory,
  VerificationStatus,
} from '@backspace/shared/src/platform';

/**
 * The words for the platform's reviews (docs/systems/admin.md), shared by a
 * space owner's panels and the admin area. Statuses, actions and categories
 * are closed unions on the wire, so each member names its one key here and
 * every surface reads the same `common:review.*` text.
 */
export type VerificationStatusKey = `common:review.verification.${VerificationStatus | 'none'}`;
export type DiscoveryStatusKey = `common:review.discovery.${DiscoveryStatus | 'none'}`;
export type ReviewActionKey = `common:review.actions.${ReviewAction}`;
export type SpaceCategoryKey = `common:review.categories.${SpaceCategory}`;

export function verificationStatusKey(status: VerificationStatus | null): VerificationStatusKey {
  return `common:review.verification.${status ?? 'none'}`;
}

export function discoveryStatusKey(status: DiscoveryStatus | null): DiscoveryStatusKey {
  return `common:review.discovery.${status ?? 'none'}`;
}

export function reviewActionKey(action: ReviewAction): ReviewActionKey {
  return `common:review.actions.${action}`;
}

export function spaceCategoryKey(category: SpaceCategory): SpaceCategoryKey {
  return `common:review.categories.${category}`;
}

/** How a status reads at a glance: settled well, waiting, refused, or nothing. */
export type ReviewTone = 'positive' | 'waiting' | 'negative' | 'neutral';

export function reviewTone(status: VerificationStatus | DiscoveryStatus | null): ReviewTone {
  switch (status) {
    case 'verified':
    case 'approved':
      return 'positive';
    case 'pending':
    case 'needs_info':
    case 'changes_requested':
      return 'waiting';
    case 'rejected':
    case 'revoked':
      return 'negative';
    default:
      return 'neutral';
  }
}
