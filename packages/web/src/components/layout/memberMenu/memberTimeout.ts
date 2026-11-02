import type { Member } from '@backspace/shared';
import { getApiForOrigin } from '../../../stores/spaceStore';
import { applySpaceMemberUpdate } from '../../../stores/spaceMemberUpdates';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import i18n from '../../../i18n';
import type { MemberTarget } from './memberRoleActions';

/**
 * Whether a member is timed out at `now`: their `timedOutUntil` (the hosting
 * instance's clock) is still ahead. A host that predates timeouts never sets
 * it, so its members never are.
 */
export function isTimedOut(member: Pick<Member, 'timedOutUntil'> | null | undefined, now: number): boolean {
  const until = member?.timedOutUntil;
  return typeof until === 'number' && until > now;
}

/**
 * End a member's timeout early, on the instance that hosts the space. The
 * answer is the member as they now are, applied to the open roster; the
 * `member_updated` broadcast carries the same row to everyone else.
 */
export async function removeMemberTimeout(target: MemberTarget, name: string): Promise<void> {
  try {
    const { member } = await getApiForOrigin(target.origin).moderation.removeTimeout(target.spaceId, target.userId);
    applySpaceMemberUpdate(target.origin, member);
    useUIStore.getState().addToast(i18n.t('spaces:members.timeout.removed', { name }), 'success', 3000);
  } catch (error) {
    useUIStore.getState().addToast(describeError(error), 'warning');
  }
}
