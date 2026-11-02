import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '@backspace/shared';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useBlockStore } from '../../stores/blockStore';
import { useSelfIdentity } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { describeError } from '../../i18n/errors';
import { isMine, parseFederatedUsername } from '../../utils/identity';

interface BlockUserButtonProps {
  /** The person the profile is about. */
  user: User;
  /** The instance that issued `user` ('' = the home instance). */
  origin: string;
  className: string;
  /** Called after a block or unblock went through. */
  onDone?: () => void;
}

/**
 * Block or unblock the person a profile shows.
 *
 * Blocking is asked about first, since it ends a friendship and hides what
 * the person writes; lifting a block is not, since it undoes itself in one
 * more click. Nothing is offered for yourself, nor for a person met on another
 * instance: a block is the home instance's and names home rows, so a remote
 * id would block somebody else.
 */
export function BlockUserButton({ user, origin, className, onDone }: BlockUserButtonProps) {
  const { t } = useTranslation(['social', 'common']);
  const self = useSelfIdentity();
  const isBlocked = useBlockStore((s) => s.blockedIds.has(user.id));
  const block = useBlockStore((s) => s.block);
  const unblock = useBlockStore((s) => s.unblock);
  const addToast = useUIStore((s) => s.addToast);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (origin !== '' || isMine(user, origin, self)) return null;

  const name = user.displayName ?? parseFederatedUsername(user.username).baseName;

  const run = async (action: 'block' | 'unblock') => {
    setPending(true);
    try {
      if (action === 'block') await block(user);
      else await unblock(user.id);
      addToast(t(action === 'block' ? 'social:block.blocked' : 'social:block.unblocked', { name }), 'success');
      setConfirming(false);
      onDone?.();
    } catch (err) {
      const key = action === 'block' ? 'social:block.failed' : 'social:block.unblockFailed';
      addToast(t(key, { name, reason: describeError(err) }), 'warning');
      setConfirming(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => { if (isBlocked) void run('unblock'); else setConfirming(true); }}
      >
        {isBlocked ? t('social:block.unblock') : t('social:block.action')}
      </button>
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => run('block')}
        title={t('social:block.confirmTitle', { name })}
        description={t('social:block.confirmBody', { name })}
        confirmLabel={t('social:block.confirmAction')}
        loading={pending}
      />
    </>
  );
}
