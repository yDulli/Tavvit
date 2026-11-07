import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NameFont } from '@backspace/shared/src/decorations';
import {
  CUSTOM_DECORATION_LIMITS,
  type CustomDecoration,
  type CustomDecorationKind,
  type CustomDecorationSort,
} from '@backspace/shared/src/customDecorations';
import { REPORT_GROUNDS, type ReportGround } from '@backspace/shared/src/legal';
import { api } from '../../../../api/client';
import { describeError } from '../../../../i18n/errors';
import { useFormatters } from '../../../../i18n/formatters';
import { useAuthStore } from '../../../../stores/authStore';
import { useUIStore } from '../../../../stores/uiStore';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { FormError, SegmentedControl } from '../_shared/SettingsControls';
import { CreateDecorationDialog } from './CreateDecorationDialog';
import { DesignPreview, DesignTile, type PreviewLook } from './DesignPreview';

/** What the gallery and one's own designs share: the kind shown, how the person looks, which design is tried on now. */
interface DesignsProps {
  kind: CustomDecorationKind;
  look: PreviewLook;
  font: NameFont | null;
  /** The id of the made design tried on in this kind, if one is. */
  selectedId: string | null;
  onSelect: (design: CustomDecoration) => void;
  /** A design went (deleted, or taken away by an administrator): whatever tried it on lets go of it. */
  onGone: (id: string) => void;
}

const SEARCH_DELAY_MS = 300;

/** A small action beside a design's name. */
function TileAction({ label, icon, onClick, pressed }: { label: string; icon: 'flag' | 'trash' | 'globe'; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      className={`icon-btn h-7 w-7 ${pressed ? 'text-accent-soft' : ''}`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** An administrator takes someone's design away, with the reason its maker is told (DSA Art. 17). */
function RemoveDesignDialog({ design, onClose, onRemoved }: { design: CustomDecoration; onClose: () => void; onRemoved: () => void }) {
  const { t } = useTranslation(['settings', 'legal', 'common']);
  const reasonId = useId();
  const groundLabel = useId();
  const [reason, setReason] = useState('');
  const [ground, setGround] = useState<ReportGround>('terms');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const length = reason.trim().length;
  const valid = length >= CUSTOM_DECORATION_LIMITS.REASON_MIN && length <= CUSTOM_DECORATION_LIMITS.REASON_MAX;

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      await api.decorations.adminRemove(design.id, { reason: reason.trim(), ground });
      onRemoved();
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('settings:decorations.made.removeTitle', { name: design.name })} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-ui leading-snug text-txt-secondary">{t('settings:decorations.made.removeText')}</p>
        <div className="space-y-1.5">
          <div id={groundLabel} className="field-label">{t('settings:decorations.made.removeGround')}</div>
          <SegmentedControl
            labelledBy={groundLabel}
            value={ground}
            onChange={setGround}
            options={REPORT_GROUNDS.map((id) => ({ id, label: t(`legal:admin.reports.grounds.${id}`) }))}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="field-label">{t('settings:decorations.made.removeReason')}</label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={CUSTOM_DECORATION_LIMITS.REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="input-standard w-full resize-none"
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="button" onClick={remove} disabled={!valid || saving} aria-busy={saving} className="btn-danger">
            {t('settings:decorations.made.remove')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The community's gallery of one kind (docs/systems/decorations.md, "Made by people"): what people
 * shared, the most worn or the newest first, searchable by name, each tried on by a click like a
 * design of Tavvit's. Someone else's design can be reported; an administrator can take it away.
 */
export function CommunityGallery({ kind, look, font, selectedId, onSelect, onGone }: DesignsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { formatNumber } = useFormatters();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const sortLabel = useId();
  const [sort, setSort] = useState<CustomDecorationSort>('popular');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<CustomDecoration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<CustomDecoration | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.decorations.gallery({ kind, sort, q: search })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [kind, sort, search, reload]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const page = await api.decorations.gallery({ kind, sort, q: search, offset: items.length });
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setTotal(page.total);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const report = (design: CustomDecoration) => useUIStore.getState().openModal('report', {
    target: { type: 'decoration', id: design.id, origin: '', label: design.name },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-tertiary" />
          <input
            type="search"
            value={query}
            maxLength={CUSTOM_DECORATION_LIMITS.QUERY_MAX}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings:decorations.made.search')}
            aria-label={t('settings:decorations.made.search')}
            className="input-search w-full pl-8"
          />
        </div>
        <div id={sortLabel} className="sr-only">{t('settings:decorations.made.sortLabel')}</div>
        <SegmentedControl
          labelledBy={sortLabel}
          value={sort}
          onChange={setSort}
          options={[
            { id: 'popular', label: t('settings:decorations.made.sort.popular') },
            { id: 'new', label: t('settings:decorations.made.sort.new') },
          ]}
        />
      </div>

      {error && <FormError>{error}</FormError>}

      {!loading && !error && items.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-hard px-4 py-6 text-center text-ui text-txt-tertiary">
          {search ? t('settings:decorations.made.noMatches') : t('settings:decorations.made.galleryEmpty')}
        </p>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
          {items.map((design) => (
            <DesignTile
              key={design.id}
              selected={selectedId === design.id}
              onSelect={() => onSelect(design)}
              preview={<DesignPreview kind={kind} design={design} look={look} font={font} />}
              title={design.name}
              detail={[
                design.creator ? t('settings:decorations.made.by', { name: design.creator.displayName || design.creator.username }) : null,
                t('settings:decorations.made.wearers', { count: design.wearers, formatted: formatNumber(design.wearers) }),
              ].filter(Boolean).join(' · ')}
              actions={(
                <>
                  {!design.mine && <TileAction label={t('settings:decorations.made.report')} icon="flag" onClick={() => report(design)} />}
                  {isAdmin && !design.mine && <TileAction label={t('settings:decorations.made.remove')} icon="trash" onClick={() => setRemoving(design)} />}
                </>
              )}
            />
          ))}
        </div>
      )}

      {items.length < total && (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} aria-busy={loading} className="btn-quiet btn-sm">
            {t('settings:decorations.made.more')}
          </button>
        </div>
      )}

      {removing && (
        <RemoveDesignDialog design={removing} onClose={() => setRemoving(null)} onRemoved={() => { onGone(removing.id); setReload((value) => value + 1); }} />
      )}
    </div>
  );
}

/**
 * The person's own designs of one kind: making a new one, putting one into the community's gallery
 * or taking it out, and deleting one, which takes it off everyone who wears it.
 */
export function MyDesigns({ kind, look, font, selectedId, onSelect, onGone }: DesignsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { formatNumber } = useFormatters();
  const loadUser = useAuthStore((s) => s.loadUser);
  const [all, setAll] = useState<CustomDecoration[]>([]);
  const [max, setMax] = useState<number>(CUSTOM_DECORATION_LIMITS.PER_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CustomDecoration | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const mine = await api.decorations.mine();
      setAll(mine.items);
      setMax(mine.max);
      setError('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const ofKind = all.filter((design) => design.kind === kind);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const full = !isAdmin && all.length >= max;

  const toggleShared = async (design: CustomDecoration) => {
    setError('');
    try {
      const updated = await api.decorations.update(design.id, { shared: !design.shared });
      setAll((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.decorations.remove(deleting.id);
      setAll((current) => current.filter((item) => item.id !== deleting.id));
      onGone(deleting.id);
      setDeleting(null);
      // It went from everyone who wore it, perhaps the person too: their own profile is read again.
      await loadUser();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-txt-tertiary">{t('settings:decorations.made.count', { made: all.length, max })}</p>
        <button type="button" onClick={() => setCreating(true)} disabled={full} className="btn-primary btn-sm">
          <Icon name="plus" size={14} />
          {t(`settings:decorations.made.createTitle.${kind}`)}
        </button>
      </div>
      {full && <p className="text-meta text-txt-tertiary">{t('settings:decorations.made.full', { max })}</p>}
      {error && <FormError>{error}</FormError>}

      {!loading && ofKind.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-hard px-4 py-6 text-center text-ui text-txt-tertiary">
          {t(`settings:decorations.made.mineEmpty.${kind}`)}
        </p>
      )}

      {ofKind.length > 0 && (
        <div className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
          {ofKind.map((design) => (
            <DesignTile
              key={design.id}
              selected={selectedId === design.id}
              onSelect={() => onSelect(design)}
              preview={<DesignPreview kind={kind} design={design} look={look} font={font} />}
              title={design.name}
              detail={design.shared
                ? t('settings:decorations.made.sharedWearers', { count: design.wearers, formatted: formatNumber(design.wearers) })
                : t('settings:decorations.made.private')}
              actions={(
                <>
                  <TileAction
                    label={design.shared ? t('settings:decorations.made.unshare') : t('settings:decorations.made.share')}
                    icon="globe"
                    pressed={design.shared}
                    onClick={() => void toggleShared(design)}
                  />
                  <TileAction label={t('settings:decorations.made.delete')} icon="trash" onClick={() => setDeleting(design)} />
                </>
              )}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateDecorationDialog
          kind={kind}
          look={look}
          font={font}
          onClose={() => setCreating(false)}
          onCreated={(design) => {
            setAll((current) => [design, ...current]);
            onSelect(design);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={() => void remove()}
        title={t('settings:decorations.made.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings:decorations.made.deleteText')}
        confirmLabel={t('settings:decorations.made.delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
