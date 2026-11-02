import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CUSTOM_EMOJI_LIMITS,
  CUSTOM_EMOJI_NAME_MAX,
  CUSTOM_EMOJI_NAME_MIN,
  normalizeEmojiName,
  type CustomEmoji,
} from '@backspace/shared/src/customEmoji';
import { useEmojiStore } from '../../../stores/emojiStore';
import { useAuthStore } from '../../../stores/authStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import { useUIStore } from '../../../stores/uiStore';
import { CustomEmojiImage } from '../../ui/CustomEmojiImage';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { SettingsField, SettingsPage, SettingsSection } from './_shared/SettingsControls';
import { describeError } from '../../../i18n/errors';
import { base64OfDataUrl } from '../../../utils/animatedImage';

/** A name for an emoji from the file's own name: lower case, letters, digits and underscores, or empty when nothing usable is left. */
export function suggestEmojiName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return normalizeEmojiName(base.slice(0, CUSTOM_EMOJI_NAME_MAX)) ?? '';
}

const SOURCE_MB = CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES / (1024 * 1024);

function AddEmojiForm() {
  const { t } = useTranslation(['settings', 'common']);
  const create = useEmojiStore((s) => s.create);
  const emojis = useEmojiStore((s) => s.emojis);
  const me = useAuthStore((s) => s.user?.id);
  const isAdmin = useSettingsStore((s) => s.isAdmin);
  const addToast = useUIStore((s) => s.addToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const own = emojis.filter((emoji) => emoji.createdBy === me).length;
  const normalized = normalizeEmojiName(name);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    if (file.size > CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES) {
      setError(t('settings:emoji.add.tooLarge', { max: SOURCE_MB }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError('');
      setPicked({ dataUrl: reader.result as string, fileName: file.name });
      setName((current) => (current.trim() === '' ? suggestEmojiName(file.name) : current));
    };
    reader.onerror = () => setError(t('settings:emoji.add.unreadable'));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picked || normalized === null) return;
    setPending(true);
    setError('');
    try {
      const emoji = await create(normalized, base64OfDataUrl(picked.dataUrl));
      addToast(t('settings:emoji.add.added', { name: emoji.name }), 'success', 2000);
      setPicked(null);
      setName('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-[22px] flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border-soft bg-surface-input text-txt-tertiary transition-colors hover:border-interactive-muted hover:text-txt-secondary active:bg-interactive-active"
          aria-label={picked ? t('settings:emoji.add.change') : t('settings:emoji.add.choose')}
          title={picked ? t('settings:emoji.add.change') : t('settings:emoji.add.choose')}
        >
          {picked
            ? <img src={picked.dataUrl} alt="" className="h-full w-full object-contain p-0.5" />
            : <Icon name="plus" size={16} />}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFile} className="hidden" />
        <div className="min-w-0 flex-1">
          <SettingsField label={t('settings:emoji.add.name')} htmlFor="emoji-name">
            <input
              id="emoji-name"
              type="text"
              value={name}
              maxLength={CUSTOM_EMOJI_NAME_MAX + 2}
              placeholder={t('settings:emoji.add.namePlaceholder')}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              aria-invalid={name.trim() !== '' && normalized === null}
              className="input-standard w-full font-mono"
            />
          </SettingsField>
          <p className="mt-1.5 text-meta leading-snug text-txt-tertiary">{t('settings:emoji.add.hint', { max: SOURCE_MB })}</p>
        </div>
      </div>

      {error !== '' && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-txt-tertiary">
          {isAdmin ? '' : t('settings:emoji.add.counter', { used: own, max: CUSTOM_EMOJI_LIMITS.MAX_PER_USER })}
        </span>
        <button
          type="submit"
          disabled={pending || !picked || normalized === null}
          aria-busy={pending}
          className="btn-primary"
        >
          {pending ? t('settings:emoji.add.submitting') : t('settings:emoji.add.submit')}
        </button>
      </div>
    </form>
  );
}

function EmojiRow({ emoji, canChange, mine }: { emoji: CustomEmoji; canChange: boolean; mine: boolean }) {
  const { t } = useTranslation(['settings', 'common']);
  const rename = useEmojiStore((s) => s.rename);
  const remove = useEmojiStore((s) => s.remove);
  const addToast = useUIStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(emoji.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async () => {
    const next = normalizeEmojiName(name);
    if (next === null || next === emoji.name) { setEditing(false); setName(emoji.name); return; }
    setPending(true);
    try {
      await rename(emoji.id, next);
      addToast(t('settings:emoji.row.renamed', { name: next }), 'success', 2000);
      setEditing(false);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setPending(false);
    }
  };

  const confirmRemove = async () => {
    setPending(true);
    try {
      await remove(emoji.id);
      addToast(t('settings:emoji.row.removed', { name: emoji.name }), 'success', 2000);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-surface-input">
        <CustomEmojiImage id={emoji.id} size="inline" className="!h-7 !min-w-7 align-middle" />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            autoFocus
            aria-label={t('settings:emoji.row.nameLabel', { name: emoji.name })}
            value={name}
            maxLength={CUSTOM_EMOJI_NAME_MAX + 2}
            minLength={CUSTOM_EMOJI_NAME_MIN}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void save(); }
              if (e.key === 'Escape') { setEditing(false); setName(emoji.name); }
            }}
            className="input-standard h-8 w-full py-0 font-mono text-meta"
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-ui text-txt-primary">:{emoji.name}:</span>
            {mine && <span className="label-mono flex-shrink-0 rounded border border-border-hard px-1 py-px text-2xs">{t('settings:emoji.row.yours')}</span>}
          </div>
        )}
      </div>
      {canChange && (
        <div className="flex flex-shrink-0 items-center gap-1">
          {editing ? (
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => { void save(); }} className="btn-outline btn-sm">{t('settings:emoji.row.save')}</button>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="btn-quiet btn-sm">{t('settings:emoji.row.rename')}</button>
          )}
          <button type="button" onClick={() => setConfirming(true)} className="btn-quiet btn-sm hover:bg-accent-rose/10 hover:text-txt-danger">{t('settings:emoji.row.delete')}</button>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirmRemove}
        title={t('settings:emoji.row.deleteConfirm.title', { name: emoji.name })}
        description={t('settings:emoji.row.deleteConfirm.body', { name: emoji.name })}
        confirmLabel={t('settings:emoji.row.deleteConfirm.action')}
        loading={pending}
      />
    </li>
  );
}

/**
 * The instance's custom emoji (shared/src/customEmoji.ts): add one, and
 * rename or remove the ones you added (an administrator, any of them).
 */
export function EmojiSettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  // Who may add is the server's to decide, and it checks again on every add. Until
  // its answer arrives the form stays away rather than offering what may be refused.
  const isAdminHere = useSettingsStore((state) => state.isAdmin);
  const emojiPolicy = useHomeInstanceInfo()?.emojiPolicy;
  const canAdd = isAdminHere || emojiPolicy === 'everyone';
  const emojis = useEmojiStore((s) => s.emojis);
  const status = useEmojiStore((s) => s.status);
  const load = useEmojiStore((s) => s.load);
  const me = useAuthStore((s) => s.user?.id);
  const isAdmin = useSettingsStore((s) => s.isAdmin);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^:|:$/g, '');
    return needle === '' ? emojis : emojis.filter((emoji) => emoji.name.includes(needle));
  }, [emojis, query]);

  return (
    <SettingsPage title={t('settings:emoji.title')} intro={t('settings:emoji.intro')}>
      {canAdd ? (
        <SettingsSection title={t('settings:emoji.add.title')}>
          <AddEmojiForm />
        </SettingsSection>
      ) : (
        <p className="text-ui leading-relaxed text-txt-tertiary">{t('settings:emoji.adminsOnly')}</p>
      )}

      <SettingsSection
        title={t('settings:emoji.library.title')}
        aside={<span className="tabular font-mono text-label text-txt-tertiary">{t('settings:emoji.library.count', { count: emojis.length })}</span>}
      >
        {status === 'failed' && emojis.length === 0 ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-ui">
            <span className="text-txt-danger">{t('settings:emoji.library.loadFailed')}</span>
            <button type="button" onClick={() => { void load(); }} className="btn-outline btn-sm">
              {t('settings:emoji.library.retry')}
            </button>
          </div>
        ) : emojis.length === 0 ? (
          <p className="text-ui text-txt-tertiary">{t('settings:emoji.library.empty')}</p>
        ) : (
          <>
            <input
              type="search"
              aria-label={t('settings:emoji.library.search')}
              placeholder={t('settings:emoji.library.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input-search w-full"
            />
            {shown.length === 0 ? (
              <p className="text-ui text-txt-tertiary">{t('settings:emoji.library.noMatches')}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border-hard">
                {shown.map((emoji) => (
                  <EmojiRow
                    key={emoji.id}
                    emoji={emoji}
                    mine={emoji.createdBy === me}
                    canChange={isAdmin || emoji.createdBy === me}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
