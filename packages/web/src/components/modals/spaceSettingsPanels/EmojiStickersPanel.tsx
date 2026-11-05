import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CUSTOM_EMOJI_LIMITS, CUSTOM_EMOJI_NAME_MAX, customEmojiUrl, normalizeEmojiName } from '@backspace/shared/src/customEmoji';
import { freeExpressionName } from '@backspace/shared/src/discordExpressionImport';
import {
  MAX_STICKER_DESCRIPTION_LENGTH,
  normalizeStickerDescription,
  type SpaceEmoji,
  type SpaceSticker,
} from '@backspace/shared/src/spaceExpressions';
import { MAX_STICKER_BYTES, MAX_STICKER_NAME_LENGTH, normalizeStickerName, stickerUrl } from '@backspace/shared/src/stickers';
import { HttpError } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { suggestEmojiName } from '../../../utils/emojiName';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { InlineNameEditor } from '../../ui/InlineNameEditor';
import { SettingsPage, SettingsSection } from '../settingsPanels/_shared/SettingsControls';

/** A list this long gets a field to find one by name. */
const FILTER_FROM = 24;
const EMOJI_SOURCE_MB = CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES / (1024 * 1024);
const STICKER_SOURCE_MB = MAX_STICKER_BYTES / (1024 * 1024);
const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Refusals after which the next file of a batch would be refused the same way. */
function endsBatch(err: unknown): boolean {
  return err instanceof HttpError && (err.code === 'rate_limited' || err.code === 'storage_limit_reached' || err.code === 'disk_full'
    || err.code === 'space_emoji_limit_reached' || err.code === 'space_sticker_limit_reached' || err.code === 'missing_permission');
}

type Removing = { kind: 'emoji'; item: SpaceEmoji } | { kind: 'sticker'; item: SpaceSticker };

/** What a screen reader says for a sticker: shown as a line, edited in place, and may be empty. */
function StickerDescription({ sticker, onSave }: { sticker: SpaceSticker; onSave: (description: string | null) => Promise<void> }) {
  const { t } = useTranslation(['spaces', 'common']);
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sticker.description ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(sticker.description ?? '');
  }, [sticker.description, editing]);

  const normalized = normalizeStickerDescription(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (normalized === undefined) return;
    if (normalized === sticker.description) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(normalized);
      setEditing(false);
    } catch {
      // The panel shows what went wrong; the field stays open with what was typed.
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`min-w-0 truncate text-meta ${sticker.description ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>
          {sticker.description ?? t('spaces:settings.expressions.stickers.noDescription')}
        </span>
        <button
          type="button"
          className="icon-btn flex-shrink-0"
          onClick={() => setEditing(true)}
          aria-label={t('spaces:settings.expressions.stickers.editDescription', { name: sticker.name })}
        >
          <Icon name="edit" size={13} />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        // The settings modal closes on Escape; leaving this field must not take it along.
        if (event.key === 'Escape') {
          event.stopPropagation();
          setEditing(false);
        }
      }}
      className="flex items-center gap-1.5"
    >
      <label htmlFor={fieldId} className="sr-only">{t('spaces:settings.expressions.stickers.descriptionLabel')}</label>
      <input
        id={fieldId}
        type="text"
        value={draft}
        maxLength={MAX_STICKER_DESCRIPTION_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t('spaces:settings.expressions.stickers.descriptionPlaceholder')}
        aria-invalid={normalized === undefined}
        disabled={saving}
        autoFocus
        className="input-standard h-8 min-w-0 flex-1 text-meta"
      />
      <button type="submit" className="btn-primary btn-sm" disabled={saving || normalized === undefined} aria-busy={saving}>
        {t('common:actions.save')}
      </button>
      <button type="button" className="btn-quiet btn-sm" onClick={() => setEditing(false)} disabled={saving}>
        {t('common:actions.cancel')}
      </button>
    </form>
  );
}

/**
 * A space's own emoji and stickers (docs/systems/emoji.md): added from pictures, named, renamed and
 * removed by whoever holds MANAGE_EMOJIS, which the server checks on every request. Everything goes
 * to the instance that hosts the space.
 */
export function EmojiStickersPanel({ spaceId, onOpenDiscord }: { spaceId: string; onOpenDiscord?: () => void }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatNumber } = useFormatters();
  const origin = useSpaceStore((state) => state.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
  const emojiInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  const filterId = useId();
  const [emojis, setEmojis] = useState<SpaceEmoji[] | null>(null);
  const [stickers, setStickers] = useState<SpaceSticker[] | null>(null);
  const [emojiMax, setEmojiMax] = useState(0);
  const [stickerMax, setStickerMax] = useState(0);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ kind: 'emoji' | 'sticker'; done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);

  const load = useCallback(async () => {
    const api = getApiForOrigin(origin).spaceExpressions;
    const [emojiList, stickerList] = await Promise.all([api.emojis(spaceId), api.stickers(spaceId)]);
    setEmojis([...emojiList.emojis].sort(byName));
    setEmojiMax(emojiList.max);
    setStickers(stickerList.stickers);
    setStickerMax(stickerList.max);
  }, [origin, spaceId]);

  useEffect(() => {
    load().catch((err: unknown) => setError(describeError(err)));
  }, [load]);

  /** Adds the picked pictures one after another, each under a free name made from its file name. */
  const addEmojis = async (files: File[]) => {
    setError('');
    setProblems([]);
    const api = getApiForOrigin(origin).spaceExpressions;
    const taken = new Set((emojis ?? []).map((emoji) => emoji.name));
    const room = Math.max(0, emojiMax - (emojis?.length ?? 0));
    const batch = files.slice(0, room);
    const found: string[] = [];
    if (files.length > batch.length) found.push(t('spaces:settings.expressions.emoji.noRoomFor', { count: files.length - batch.length }));
    setProgress({ kind: 'emoji', done: 0, total: batch.length });
    for (const [index, file] of batch.entries()) {
      if (file.size > CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES) {
        found.push(t('spaces:settings.expressions.fileTooLarge', { name: file.name, max: formatNumber(EMOJI_SOURCE_MB) }));
      } else {
        const name = freeExpressionName(suggestEmojiName(file.name) || 'emoji', taken, 'emoji');
        try {
          const emoji = await api.addEmoji(spaceId, { name, image: toBase64(new Uint8Array(await file.arrayBuffer())) });
          taken.add(emoji.name);
          setEmojis((current) => [...(current ?? []), emoji].sort(byName));
        } catch (err) {
          found.push(t('spaces:settings.expressions.fileFailed', { name: file.name, reason: describeError(err) }));
          if (endsBatch(err)) break;
        }
      }
      setProgress({ kind: 'emoji', done: index + 1, total: batch.length });
    }
    setProgress(null);
    setProblems(found);
  };

  const addStickers = async (files: File[]) => {
    setError('');
    setProblems([]);
    const api = getApiForOrigin(origin).spaceExpressions;
    const taken = new Set((stickers ?? []).map((sticker) => sticker.name.toLowerCase()));
    const room = Math.max(0, stickerMax - (stickers?.length ?? 0));
    const batch = files.slice(0, room);
    const found: string[] = [];
    if (files.length > batch.length) found.push(t('spaces:settings.expressions.stickers.noRoomFor', { count: files.length - batch.length }));
    setProgress({ kind: 'sticker', done: 0, total: batch.length });
    for (const [index, file] of batch.entries()) {
      if (file.size > MAX_STICKER_BYTES) {
        found.push(t('spaces:settings.expressions.fileTooLarge', { name: file.name, max: formatNumber(STICKER_SOURCE_MB) }));
      } else {
        const base = normalizeStickerName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')) ?? t('spaces:settings.expressions.stickers.untitled');
        const name = freeExpressionName(base, taken, 'sticker');
        try {
          const sticker = await api.addSticker(spaceId, { name, image: toBase64(new Uint8Array(await file.arrayBuffer())) });
          taken.add(sticker.name.toLowerCase());
          setStickers((current) => [...(current ?? []), sticker]);
        } catch (err) {
          found.push(t('spaces:settings.expressions.fileFailed', { name: file.name, reason: describeError(err) }));
          if (endsBatch(err)) break;
        }
      }
      setProgress({ kind: 'sticker', done: index + 1, total: batch.length });
    }
    setProgress(null);
    setProblems(found);
  };

  const pick = (kind: 'emoji' | 'sticker') => (change: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(change.target.files ?? []);
    change.target.value = '';
    if (files.length === 0) return;
    void (kind === 'emoji' ? addEmojis(files) : addStickers(files));
  };

  const renameEmoji = async (emoji: SpaceEmoji, name: string) => {
    setError('');
    try {
      const updated = await getApiForOrigin(origin).spaceExpressions.renameEmoji(emoji.id, name);
      setEmojis((current) => (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)).sort(byName));
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const updateSticker = async (sticker: SpaceSticker, body: { name?: string; description?: string | null }) => {
    setError('');
    try {
      const updated = await getApiForOrigin(origin).spaceExpressions.updateSticker(sticker.id, body);
      setStickers((current) => (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    setError('');
    try {
      const api = getApiForOrigin(origin).spaceExpressions;
      if (target.kind === 'emoji') {
        await api.removeEmoji(target.item.id);
        setEmojis((current) => (current ?? []).filter((entry) => entry.id !== target.item.id));
      } else {
        await api.removeSticker(target.item.id);
        setStickers((current) => (current ?? []).filter((entry) => entry.id !== target.item.id));
      }
    } catch (err) {
      setError(describeError(err));
    }
  };

  const wanted = filter.trim().toLowerCase();
  const shownEmojis = useMemo(
    () => (emojis ?? []).filter((emoji) => wanted === '' || emoji.name.includes(wanted)),
    [emojis, wanted],
  );
  const shownStickers = useMemo(
    () => (stickers ?? []).filter((sticker) => wanted === '' || sticker.name.toLowerCase().includes(wanted)),
    [stickers, wanted],
  );

  const busy = progress !== null;
  const emojiFull = emojis !== null && emojis.length >= emojiMax;
  const stickersFull = stickers !== null && stickers.length >= stickerMax;
  const loaded = emojis !== null && stickers !== null;
  const many = (emojis?.length ?? 0) + (stickers?.length ?? 0) >= FILTER_FROM;

  return (
    <SettingsPage title={t('spaces:settings.expressions.title')} intro={t('spaces:settings.expressions.intro')}>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {problems.length > 0 && (
        <div role="alert" className="rounded-md border border-accent-rose/25 bg-accent-rose/[0.04] px-3 py-2">
          <ul className="space-y-0.5 text-meta text-txt-secondary">
            {problems.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </div>
      )}

      {loaded && emojis.length === 0 && stickers.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true"><Icon name="smile" size={18} /></span>
          <p className="empty-state-title">{t('spaces:settings.expressions.emptyTitle')}</p>
          <p className="empty-state-body">{t('spaces:settings.expressions.emptyBody')}</p>
          {onOpenDiscord && (
            <button type="button" className="btn-outline btn-sm mt-3" onClick={onOpenDiscord}>
              <Icon name="download" size={14} />
              {t('spaces:settings.expressions.fromDiscord')}
            </button>
          )}
        </div>
      )}

      {loaded && many && (
        <div className="relative">
          <label htmlFor={filterId} className="sr-only">{t('spaces:settings.expressions.filter')}</label>
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-tertiary" />
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('spaces:settings.expressions.filter')}
            className="input-search w-full pl-8"
          />
        </div>
      )}

      <SettingsSection
        title={t('spaces:settings.expressions.emoji.title')}
        aside={emojis && (
          <span className="tabular font-mono text-label text-txt-tertiary">
            {t('spaces:settings.expressions.count', { used: formatNumber(emojis.length), max: formatNumber(emojiMax) })}
          </span>
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input ref={emojiInput} type="file" accept={PICTURE_TYPES} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick('emoji')} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => emojiInput.current?.click()}
            disabled={!loaded || busy || emojiFull}
            aria-busy={progress?.kind === 'emoji'}
          >
            <Icon name="plus" size={15} />
            {t('spaces:settings.expressions.emoji.add')}
          </button>
          <p className="min-w-0 flex-1 basis-56 text-meta leading-snug text-txt-tertiary">
            {progress?.kind === 'emoji'
              ? t('spaces:settings.expressions.progress', { done: formatNumber(progress.done), total: formatNumber(progress.total) })
              : t('spaces:settings.expressions.emoji.hint', { max: formatNumber(EMOJI_SOURCE_MB) })}
          </p>
        </div>
        {shownEmojis.length > 0 && (
          <ul className="grid grid-cols-1 gap-1.5 desktop:grid-cols-2">
            {shownEmojis.map((emoji) => (
              <li key={emoji.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border-soft px-2 py-1.5">
                <img
                  src={`${origin}${customEmojiUrl(emoji.id)}`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-7 w-7 flex-shrink-0 object-contain"
                />
                <div className="min-w-0 flex-1 font-mono">
                  <InlineNameEditor
                    name={emoji.name}
                    icon={null}
                    canEdit
                    editLabel={t('spaces:settings.expressions.emoji.rename', { name: emoji.name })}
                    fieldLabel={t('spaces:settings.expressions.emoji.nameLabel')}
                    maxLength={CUSTOM_EMOJI_NAME_MAX}
                    normalize={(value) => normalizeEmojiName(value) ?? ''}
                    onSave={(name) => renameEmoji(emoji, name)}
                  />
                </div>
                {emoji.animated && (
                  <span className="flex-shrink-0 font-mono text-2xs uppercase text-txt-tertiary">{t('spaces:settings.expressions.animated')}</span>
                )}
                <button
                  type="button"
                  className="icon-btn flex-shrink-0"
                  onClick={() => setRemoving({ kind: 'emoji', item: emoji })}
                  aria-label={t('spaces:settings.expressions.emoji.remove', { name: emoji.name })}
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('spaces:settings.expressions.stickers.title')}
        aside={stickers && (
          <span className="tabular font-mono text-label text-txt-tertiary">
            {t('spaces:settings.expressions.count', { used: formatNumber(stickers.length), max: formatNumber(stickerMax) })}
          </span>
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input ref={stickerInput} type="file" accept={PICTURE_TYPES} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick('sticker')} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => stickerInput.current?.click()}
            disabled={!loaded || busy || stickersFull}
            aria-busy={progress?.kind === 'sticker'}
          >
            <Icon name="plus" size={15} />
            {t('spaces:settings.expressions.stickers.add')}
          </button>
          <p className="min-w-0 flex-1 basis-56 text-meta leading-snug text-txt-tertiary">
            {progress?.kind === 'sticker'
              ? t('spaces:settings.expressions.progress', { done: formatNumber(progress.done), total: formatNumber(progress.total) })
              : t('spaces:settings.expressions.stickers.hint', { max: formatNumber(STICKER_SOURCE_MB) })}
          </p>
        </div>
        {shownStickers.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {shownStickers.map((sticker) => {
              const picture = stickerUrl(sticker.token);
              return (
                <li key={sticker.id} className="flex min-w-0 items-center gap-3 rounded-md border border-border-soft p-2">
                  {picture
                    ? <img src={picture} alt="" loading="lazy" decoding="async" draggable={false} className="h-14 w-14 flex-shrink-0 object-contain" />
                    : <span className="h-14 w-14 flex-shrink-0" aria-hidden="true" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <InlineNameEditor
                      name={sticker.name}
                      icon={null}
                      canEdit
                      editLabel={t('spaces:settings.expressions.stickers.rename', { name: sticker.name })}
                      fieldLabel={t('spaces:settings.expressions.stickers.nameLabel')}
                      maxLength={MAX_STICKER_NAME_LENGTH}
                      normalize={(value) => normalizeStickerName(value) ?? ''}
                      onSave={(name) => updateSticker(sticker, { name })}
                    />
                    <StickerDescription sticker={sticker} onSave={(description) => updateSticker(sticker, { description })} />
                  </div>
                  {sticker.animated && (
                    <span className="flex-shrink-0 font-mono text-2xs uppercase text-txt-tertiary">{t('spaces:settings.expressions.animated')}</span>
                  )}
                  <button
                    type="button"
                    className="icon-btn flex-shrink-0"
                    onClick={() => setRemoving({ kind: 'sticker', item: sticker })}
                    aria-label={t('spaces:settings.expressions.stickers.remove', { name: sticker.name })}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        title={removing?.kind === 'sticker'
          ? t('spaces:settings.expressions.stickers.removeTitle', { name: removing.item.name })
          : t('spaces:settings.expressions.emoji.removeTitle', { name: removing?.item.name ?? '' })}
        description={removing?.kind === 'sticker'
          ? t('spaces:settings.expressions.stickers.removeBody')
          : t('spaces:settings.expressions.emoji.removeBody', { name: removing?.item.name ?? '' })}
        confirmLabel={t('common:actions.delete')}
        variant="danger"
      />
    </SettingsPage>
  );
}
