import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_STICKER_NAME_LENGTH, normalizeStickerName, stickerUrl, type PersonalSticker } from '@backspace/shared/src/stickers';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { usePickerEscapeClaim } from './pickerEscape';
import { Icon } from '../ui/Icon';

interface StickerRenameFormProps {
  sticker: PersonalSticker;
  /** Called with the stored entry once the server accepted the new name. */
  onRenamed: (sticker: PersonalSticker) => void;
  onCancel: () => void;
}

/**
 * Renames one collection entry. It takes the picker's place, like the upload
 * form, instead of floating over it: the picker already sits in a popover or
 * a sheet that closes on an outside click, so a portaled dialog would close
 * the picker that owns it. The name is checked with the server's own rule
 * (`normalizeStickerName`) before it is sent. Escape cancels it, except
 * while the new name is being saved, and only the next Escape closes the
 * picker.
 */
export function StickerRenameForm({ sticker, onRenamed, onCancel }: StickerRenameFormProps) {
  const { t } = useTranslation(['chat', 'errors']);
  const headingId = useId();
  const inputId = useId();
  const [name, setName] = useState(sticker.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);

  usePickerEscapeClaim(() => {
    if (!writing.current) onCancel();
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (writing.current) return;
    const next = normalizeStickerName(name);
    if (next === undefined) {
      setError(t('errors:sticker_name_invalid', { max: MAX_STICKER_NAME_LENGTH }));
      return;
    }
    if (next === sticker.name) {
      onCancel();
      return;
    }
    writing.current = true;
    setSaving(true);
    setError('');
    try {
      onRenamed(await api.stickers.rename(sticker.id, next));
    } catch (err) {
      setError(describeError(err));
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={event => void submit(event)} aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border-hard py-2 pl-4 pr-2">
        <h3 id={headingId} className="text-ui font-semibold">{t('chat:stickers.renameTitle')}</h3>
        <button type="button" disabled={saving} onClick={onCancel} className="sticker-icon-button" aria-label={t('chat:stickers.cancel')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-3">
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-border-hard bg-surface-input/40 p-4 sticker-checkerboard">
          <img src={stickerUrl(sticker.token) ?? undefined} alt={sticker.name} className="h-32 w-full object-contain" />
        </div>
        <div>
          <label htmlFor={inputId} className="field-label">
            {t('chat:stickers.name')}
          </label>
          <input
            id={inputId}
            value={name}
            disabled={saving}
            maxLength={MAX_STICKER_NAME_LENGTH}
            autoFocus
            onChange={event => {
              setName(event.target.value);
              setError('');
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="input-search w-full"
            placeholder={t('chat:stickers.name')}
          />
        </div>
        {error && (
          <p id={`${inputId}-error`} role="alert" className="rounded-md border border-accent-rose/25 bg-accent-rose/10 px-3 py-2 text-meta text-txt-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border-hard px-3 py-2">
        <button type="button" disabled={saving} onClick={onCancel} className="sticker-secondary-button">
          {t('chat:stickers.cancel')}
        </button>
        <button type="submit" disabled={saving || !name.trim()} className="sticker-primary-button">
          {saving && <span className="sticker-spinner" aria-hidden="true" />}
          {t('chat:stickers.rename')}
        </button>
      </div>
    </form>
  );
}
