import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PERSONAL_STICKERS, type PersonalSticker } from '@backspace/shared/src/stickers';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { DIRECT_MESSAGE_EMOJI_CONTEXT, useEmojiSets, type EmojiContext } from '../../utils/emojiSets';
import { StickerUploadForm } from './StickerUploadForm';
import { StickerRenameForm } from './StickerRenameForm';
import { StickerGrid } from './StickerGrid';
import { describeError } from '../../i18n/errors';
import { Icon } from '../ui/Icon';
import './stickers.css';

/** Entries whose name holds the query, ignoring case. A blank query keeps every entry. */
export function filterStickers(items: PersonalSticker[], query: string): PersonalSticker[] {
  const needle = query.trim().toLowerCase();
  return needle ? items.filter(item => item.name.toLowerCase().includes(needle)) : items;
}

/**
 * The stickers a person can send where they write: their own collection first, then the stickers
 * of the spaces they are in on the instance the text goes to (docs/systems/emoji.md), the space
 * written in first. In a direct message, the spaces of this page's instance: a sticker reaches the
 * other side only from the writer's home or this instance (`mayPostSticker`).
 */
export function StickerPicker({ onSelect, mobile = false, context = DIRECT_MESSAGE_EMOJI_CONTEXT }: {
  onSelect: (token: string) => void;
  mobile?: boolean;
  context?: EmojiContext;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const userId = useAuthStore(s => s.user?.id);
  const sets = useEmojiSets(context);
  const spaceSections = useMemo(() => sets
    .filter((set) => set.space !== null && set.stickers.length > 0)
    .map((set) => ({
      key: set.key,
      title: set.space?.name ?? '',
      items: set.stickers.map((sticker): PersonalSticker => ({ id: sticker.stickerId, name: sticker.name, token: sticker.token })),
    })), [sets]);
  const [items, setItems] = useState<PersonalSticker[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<PersonalSticker | null>(null);
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Where focus goes once a form closed and the grid is drawn again, the
   * first of these that is there and enabled: the tile whose rename closed,
   * or the upload button.
   */
  const focusAfterForm = useRef<string[] | null>(null);

  useEffect(() => {
    let active = true;
    setItems([]);
    setLoading(true);
    setError('');
    setNotice('');
    setUploading(false);
    setRenaming(null);
    setManaging(false);
    setSearch('');
    api.stickers.list().then(rows => { if (active) setItems(rows); })
      .catch((err: unknown) => { if (active) setError(describeError(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    const targets = focusAfterForm.current;
    if (renaming || uploading || !targets) return;
    focusAfterForm.current = null;
    const root = rootRef.current;
    for (const selector of targets) {
      const target = root?.querySelector<HTMLElement>(`${selector}:not(:disabled)`);
      if (target) {
        target.focus();
        return;
      }
    }
  }, [renaming, uploading]);

  const remove = async (id: string) => {
    setRemoving(id);
    setError('');
    setNotice('');
    try {
      await api.stickers.remove(id);
      setItems(rows => rows.filter(row => row.id !== id));
    } catch (err) { setError(describeError(err)); }
    finally { setRemoving(null); }
  };

  const full = items.length >= MAX_PERSONAL_STICKERS;
  const visible = filterStickers(items, search);
  const visibleSections = spaceSections
    .map((section) => ({ ...section, items: filterStickers(section.items, search) }))
    .filter((section) => section.items.length > 0);
  const spaceStickerCount = spaceSections.reduce((sum, section) => sum + section.items.length, 0);
  const nothingMatches = search.trim() !== '' && visible.length === 0 && visibleSections.length === 0;

  const startUpload = () => {
    setError('');
    setNotice('');
    setUploading(true);
  };

  const startRename = (sticker: PersonalSticker) => {
    setError('');
    setNotice('');
    setRenaming(sticker);
  };

  const closeUpload = () => {
    focusAfterForm.current = ['[data-sticker-upload]', '[data-sticker-id]'];
    setUploading(false);
  };

  const closeRename = () => {
    if (renaming) focusAfterForm.current = [`[data-sticker-rename="${renaming.id}"]`, `[data-sticker-id="${renaming.id}"]`];
    setRenaming(null);
  };

  return (
    <div
      ref={rootRef}
      className={`flex flex-col min-h-0 text-txt-primary ${mobile ? 'w-full flex-1' : 'w-[352px] max-w-[calc(100*var(--app-vw)-24px)] h-[456px]'}`}
      onKeyDown={event => {
        // Keys stay in the picker, so Enter never reaches the composer. Escape
        // belongs to the picker's host (pickerEscape.tsx), which gives it to
        // an open form first.
        if (event.key !== 'Escape') event.stopPropagation();
      }}
    >
      {uploading ? <StickerUploadForm key={userId} capacity={Math.max(0, MAX_PERSONAL_STICKERS - items.length)}
        onCancel={closeUpload} onAdded={(added, complete) => {
          // Newest first, the order the server lists the collection in.
          setItems(rows => {
            const ids = new Set(added.map(item => item.id));
            return [...[...added].reverse(), ...rows.filter(row => !ids.has(row.id))];
          });
          if (!complete) return;
          closeUpload();
          setManaging(false);
          setNotice(t('stickers.saved'));
        }} /> : renaming ? <StickerRenameForm key={renaming.id} sticker={renaming} onCancel={closeRename}
        onRenamed={updated => {
          setItems(rows => rows.map(row => row.id === updated.id ? { ...row, name: updated.name } : row));
          closeRename();
        }} /> : <>
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h3 className="text-ui font-semibold">{t('stickers.title')} <span className="tabular ml-1 font-mono text-label font-normal text-txt-tertiary">{!loading && items.length}</span></h3>
          <div className="flex items-center gap-1">
            {items.length > 0 && <button type="button" disabled={!!removing} aria-pressed={managing}
              className="sticker-secondary-button" onClick={() => setManaging(!managing)}>{t(managing ? 'stickers.done' : 'stickers.manage')}</button>}
            <button type="button" data-sticker-upload disabled={loading || !!removing || full} onClick={startUpload} className="sticker-primary-button">
              <Icon name="plus" size={14} />{t('stickers.upload')}
            </button>
          </div>
        </div>
        <p className="px-4 pb-3 text-meta text-txt-tertiary">{t(managing ? 'stickers.manageHint' : full ? 'stickers.full' : 'stickers.collectionHint')}</p>
        {(items.length > 0 || spaceStickerCount > 0) && <div className="relative mx-4 mb-3 flex shrink-0 items-center">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-txt-tertiary" />
          <input type="text" role="searchbox" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={t('stickers.search')} aria-label={t('stickers.search')} maxLength={100}
            className="input-search h-8 w-full py-0 pl-8 pr-8 text-ui" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label={t('common:actions.clear')}
            className="icon-btn absolute right-1 h-6 w-6">
            <Icon name="x" size={14} />
          </button>}
        </div>}
        {error && <p role="alert" className="mx-4 mb-3 rounded-md border border-accent-rose/25 bg-accent-rose/10 px-3 py-2 text-meta text-txt-danger">{error}</p>}
        {notice && <p role="status" className="mx-4 mb-2 text-meta text-txt-positive">{notice}</p>}
        {loading ? <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-3">
          <div role="status" aria-label={t('stickers.loading')} className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, index) => <div key={index} className="skeleton skeleton-block aspect-square" />)}
          </div>
        </div> : <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (!error && (search.trim() === '' || spaceStickerCount === 0) && <div className={`empty-state ${spaceStickerCount > 0 ? 'py-6' : 'h-full min-h-48'}`}>
            <span className="empty-state-icon" aria-hidden="true">
              <Icon name="smile" size={18} />
            </span>
            <p className="empty-state-title">{t('stickers.empty')}</p>
            <p className="empty-state-body">{t('stickers.emptyHint')}</p>
            <button type="button" onClick={startUpload} className="btn-outline btn-sm mt-2">{t('stickers.chooseImage')}</button>
          </div>) : (visible.length > 0 || nothingMatches) && <StickerGrid flat items={visible} noMatches={nothingMatches} managing={managing} removing={removing}
            onSelect={onSelect} onRename={startRename} onRemove={id => void remove(id)} />}
          {/* The spaces' stickers are the spaces' to manage: here they are only sent. */}
          {!managing && visibleSections.map((section) => (
            <section key={section.key} aria-label={t('stickers.spaceSection', { space: section.title })}>
              <h4 className="label-mono truncate px-4 pb-1.5 pt-2">{section.title}</h4>
              <StickerGrid flat items={section.items} noMatches={false} managing={false} removing={null}
                onSelect={onSelect} onRename={() => undefined} onRemove={() => undefined} />
            </section>
          ))}
        </div>}
        <div className="shrink-0 border-t border-border-hard px-4 py-2 text-label text-txt-tertiary">{t('stickers.limits')}</div>
      </>}
    </div>
  );
}
