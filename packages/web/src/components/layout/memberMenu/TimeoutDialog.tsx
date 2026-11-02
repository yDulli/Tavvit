import React, { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MODERATION_LIMITS, TIMEOUT_DURATIONS_SECONDS } from '@backspace/shared';
import { Modal } from '../../ui/Modal';
import { OptionCards } from '../../modals/settingsPanels/_shared/SettingsControls';
import { getApiForOrigin } from '../../../stores/spaceStore';
import { applySpaceMemberUpdate } from '../../../stores/spaceMemberUpdates';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import type { MemberTarget } from './memberRoleActions';

/** The length offered first: long enough to calm a conversation down, short enough not to punish. */
const DEFAULT_DURATION_SECONDS = 600;

/** The end of a timeout as a clock time today, or with its date when it ends on another day. */
function useTimeoutEndLabel(): (end: number) => string {
  const { formatTime, formatDateTime } = useFormatters();
  return (end) => (new Date(end).toDateString() === new Date().toDateString() ? formatTime(end) : formatDateTime(end));
}

/**
 * Times one member out of one space: a length from `TIMEOUT_DURATIONS_SECONDS`
 * and an optional reason, which the audit log keeps. Sent to the instance that
 * hosts the space with the member's id there; the answer is the member as they
 * now are, applied to the open roster.
 */
export function TimeoutDialog({ target, name, onClose }: {
  target: MemberTarget;
  /** The member's name in this space. */
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatInterval, formatNumber } = useFormatters();
  const endLabel = useTimeoutEndLabel();
  const [duration, setDuration] = useState<string>(String(DEFAULT_DURATION_SECONDS));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const durationLabelId = useId();
  const reasonId = useId();
  const close = () => { if (!writing.current) onClose(); };

  const durationSeconds = Number(duration);
  const max = MODERATION_LIMITS.MAX_REASON_LENGTH;
  const trimmedReason = reason.trim();

  const submit = async () => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    try {
      const { member } = await getApiForOrigin(target.origin).moderation.timeoutMember(target.spaceId, target.userId, {
        durationSeconds,
        reason: trimmedReason.length > 0 ? trimmedReason : null,
      });
      applySpaceMemberUpdate(target.origin, member);
      const until = member.timedOutUntil ?? Date.now() + durationSeconds * 1000;
      useUIStore.getState().addToast(t('spaces:members.timeout.done', { name, time: endLabel(until) }), 'success', 3000);
      writing.current = false;
      onClose();
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
      writing.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const options = TIMEOUT_DURATIONS_SECONDS.map((seconds) => ({ id: String(seconds), label: formatInterval(seconds) }));

  return (
    <Modal isOpen onClose={close} title={t('spaces:members.timeout.title', { name })} mobileStyle="sheet">
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-body text-txt-secondary">{t('spaces:members.timeout.description')}</p>

        <div id={durationLabelId} className="label-mono mb-2">{t('spaces:members.timeout.duration')}</div>
        <OptionCards labelledBy={durationLabelId} value={duration} options={options} onChange={setDuration} columns={3} />
        <p className="mt-2 text-meta text-txt-tertiary">
          {t('spaces:members.timeout.ends', { time: endLabel(Date.now() + durationSeconds * 1000) })}
        </p>

        <div className="mt-4">
          <label htmlFor={reasonId} className="label-mono mb-2 block">{t('spaces:members.timeout.reason')}</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, max))}
            maxLength={max}
            rows={3}
            disabled={saving}
            placeholder={t('spaces:members.timeout.reasonPlaceholder')}
            className="input-standard w-full resize-none"
          />
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-meta text-txt-tertiary">{t('spaces:members.timeout.reasonHint')}</span>
            <span className="font-mono tabular-nums text-label text-txt-tertiary">
              {t('spaces:members.timeout.reasonCounter', { length: formatNumber(reason.length), max: formatNumber(max) })}
            </span>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} disabled={saving} className="btn-quiet disabled:opacity-50">
            {t('common:actions.cancel')}
          </button>
          <button type="submit" disabled={saving} className="btn-danger disabled:opacity-50">
            {saving ? t('common:states.pleaseWait') : t('spaces:members.timeout.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
