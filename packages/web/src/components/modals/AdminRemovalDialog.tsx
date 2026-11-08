import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOVAL_REASON_LIMITS, type RemovalRequest } from '@backspace/shared/src/adminRemoval';
import { REPORT_GROUNDS, type ReportGround } from '@backspace/shared/src/legal';
import { describeError } from '../../i18n/errors';
import { Modal } from '../ui/Modal';
import { FormError, SegmentedControl } from './settingsPanels/_shared/SettingsControls';

/**
 * An administrator taking something away directly (docs/systems/admin.md, "Removing content"): what
 * goes, the ground and the reason the person it concerns is told, with how to object (DSA Art. 17).
 * Every direct removal asks through this, a message, parts of a profile or a space, one of a space's
 * emoji, stickers and sounds, the whole space, a decoration someone made; the server checks again.
 */
export function AdminRemovalDialog({ title, text, submitLabel, canSubmit = true, children, onRemove, onClose }: {
  title: string;
  text: string;
  submitLabel?: string;
  /** False while what to remove is not chosen yet (the parts of a profile or a space). */
  canSubmit?: boolean;
  /** What to remove, where there is a choice. */
  children?: ReactNode;
  onRemove: (removal: RemovalRequest) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'legal', 'common']);
  const reasonId = useId();
  const reasonHintId = useId();
  const groundLabel = useId();
  const [reason, setReason] = useState('');
  const [ground, setGround] = useState<ReportGround>('terms');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const length = reason.trim().length;
  const valid = canSubmit && length >= REMOVAL_REASON_LIMITS.MIN && length <= REMOVAL_REASON_LIMITS.MAX;

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      await onRemove({ reason: reason.trim(), ground });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-ui leading-snug text-txt-secondary">{text}</p>
        {children}
        <div className="space-y-1.5">
          <div id={groundLabel} className="field-label">{t('admin:removal.ground')}</div>
          <SegmentedControl
            labelledBy={groundLabel}
            value={ground}
            onChange={setGround}
            options={REPORT_GROUNDS.map((id) => ({ id, label: t(`legal:admin.reports.grounds.${id}`) }))}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="field-label">{t('admin:removal.reason')}</label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={REMOVAL_REASON_LIMITS.MAX}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            aria-describedby={reasonHintId}
            className="input-standard w-full resize-none"
          />
          <p id={reasonHintId} className="text-meta leading-snug text-txt-tertiary">{t('admin:removal.reasonHint')}</p>
        </div>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="button" onClick={remove} disabled={!valid || saving} aria-busy={saving} className="btn-danger">
            {submitLabel ?? t('admin:removal.submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
