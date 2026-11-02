import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MODERATION_REASON_MAX_LENGTH } from '@backspace/shared';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { getCurrentMember, type MemberTarget } from './memberRoleActions';

/** Kicking or banning one member: why, and for a ban how much of what they wrote goes with them. */
export function MemberRemovalDialog({ target, action, name, onClose, onDone }: {
  target: MemberTarget;
  action: 'kick' | 'ban';
  name: string;
  onClose: () => void;
  /** After the member is gone, for a surface that holds its own list. */
  onDone?: () => void;
}) {
  const { t } = useTranslation('spaces');
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [deleteSeconds, setDeleteSeconds] = useState(0);
  const writing = useRef(false);
  const reasonId = useId();
  const deleteId = useId();
  const confirm = async () => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    try {
      const api = getApiForOrigin(target.origin);
      const why = reason.trim() || undefined;
      if (action === 'kick') await api.spaces.removeMember(target.spaceId, target.userId, why);
      else await api.spaces.ban(target.spaceId, target.userId, why, deleteSeconds);
      if (getCurrentMember(target)) useSpaceStore.getState().removeMember(target.spaceId, target.userId);
      onDone?.();
      onClose();
    } catch (error) {
      useUIStore.getState().addToast(describeError(error), 'warning');
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };
  return <ConfirmDialog isOpen onClose={() => { if (!writing.current) onClose(); }} onConfirm={() => void confirm()}
    title={t(action === 'kick' ? 'settings.members.confirm.kickTitle' : 'settings.members.confirm.banTitle', { name })}
    description={(
      <div className="space-y-3">
        <p>{t(action === 'kick' ? 'settings.members.confirm.kickDescription' : 'settings.members.confirm.banDescription')}</p>
        <div>
          <label htmlFor={reasonId} className="field-label">{t('settings.members.reason.label')}</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MODERATION_REASON_MAX_LENGTH}
            rows={2}
            className="input-standard w-full resize-none"
          />
          <p className="mt-1 text-meta text-txt-tertiary">{t('settings.members.reason.hint')}</p>
        </div>
        {action === 'ban' && (
          <div>
            <label htmlFor={deleteId} className="field-label">{t('settings.members.deleteMessages.label')}</label>
            <select id={deleteId} value={deleteSeconds} onChange={(event) => setDeleteSeconds(Number(event.target.value))} className="input-standard w-full">
              <option value={0}>{t('settings.members.deleteMessages.none')}</option>
              <option value={3600}>{t('settings.members.deleteMessages.hour')}</option>
              <option value={86400}>{t('settings.members.deleteMessages.day')}</option>
              <option value={604800}>{t('settings.members.deleteMessages.week')}</option>
            </select>
          </div>
        )}
      </div>
    )}
    confirmLabel={t(action === 'kick' ? 'settings.members.kick' : 'settings.members.ban')} variant="danger" loading={saving} />;
}
