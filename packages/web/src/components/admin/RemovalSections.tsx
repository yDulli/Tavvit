import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROFILE_REMOVABLE_PARTS,
  SPACE_REMOVABLE_PARTS,
  type AdminSpaceExpressions,
  type ProfileRemovablePart,
  type SpaceExpressionKind,
  type SpaceRemovablePart,
} from '@backspace/shared/src/adminRemoval';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useUIStore } from '../../stores/uiStore';
import { AdminRemovalDialog } from '../modals/AdminRemovalDialog';
import { Icon } from '../ui/Icon';

/**
 * Removing content from the admin console (docs/systems/admin.md, "Removing content"): parts of a
 * person's profile, parts of a space, one of its emoji, stickers and sounds, the whole space. Each
 * asks for its reason and ground in the same dialog (`AdminRemovalDialog`); the server checks again
 * and tells the person it concerns.
 */

/** The parts to choose from, as checkboxes. */
function PartChoices<Part extends string>({ legend, parts, chosen, label, onChange }: {
  legend: string;
  parts: readonly Part[];
  chosen: readonly Part[];
  label: (part: Part) => string;
  onChange: (chosen: Part[]) => void;
}) {
  const toggle = (part: Part, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(part);
    else next.delete(part);
    onChange(parts.filter((candidate) => next.has(candidate)));
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="field-label">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {parts.map((part) => (
          <label key={part} className="flex items-center gap-2 text-ui text-txt-primary">
            <input type="checkbox" checked={chosen.includes(part)} onChange={(event) => toggle(part, event.target.checked)} />
            {label(part)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function useDone(): () => void {
  const { t } = useTranslation(['admin']);
  return useCallback(() => useUIStore.getState().addToast(t('admin:removal.done'), 'success'), [t]);
}

/**
 * Parts of a person's profile, in the moderation tab of their account. `keptBy` names the home of a
 * copy whose profile that instance keeps (`AdminUser.profileKeptByHome`): the server refuses to
 * remove from it, so the section says where it is done instead of offering what cannot be.
 */
export function ProfileRemovalSection({ userId, keptBy, onChanged }: { userId: string; keptBy: string | null; onChanged: () => void }) {
  const { t } = useTranslation(['admin']);
  const done = useDone();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<ProfileRemovablePart[]>([]);

  return (
    <section className="space-y-2.5">
      <h3 className="label-mono">{t('admin:removal.profile.title')}</h3>
      <div className="surface-card space-y-3 rounded-lg p-4">
        {keptBy ? (
          <p className="text-meta text-txt-tertiary">{t('admin:removal.profile.keptByHome', { instance: keptBy })}</p>
        ) : (
          <>
            <p className="text-meta text-txt-tertiary">{t('admin:removal.profile.text')}</p>
            <button type="button" onClick={() => { setParts([]); setOpen(true); }} className="btn-outline btn-sm">
              {t('admin:removal.profile.open')}
            </button>
          </>
        )}
      </div>
      {open && (
        <AdminRemovalDialog
          title={t('admin:removal.profile.title')}
          text={t('admin:removal.profile.text')}
          canSubmit={parts.length > 0}
          onRemove={async (removal) => {
            await api.admin.removeProfileContent(userId, { ...removal, parts });
            done();
            onChanged();
          }}
          onClose={() => setOpen(false)}
        >
          <PartChoices
            legend={t('admin:removal.profile.title')}
            parts={PROFILE_REMOVABLE_PARTS}
            chosen={parts}
            label={(part) => t(`admin:removal.parts.${part}`)}
            onChange={setParts}
          />
        </AdminRemovalDialog>
      )}
    </section>
  );
}

type Pending =
  | { kind: 'parts' }
  | { kind: 'expression'; expression: SpaceExpressionKind; id: string; name: string }
  | { kind: 'delete' };

/** Parts of a space, its emoji, stickers and sounds one by one, and the whole space, in its admin view. */
export function SpaceRemovalSection({ spaceId, spaceName, onChanged, onDeleted }: {
  spaceId: string;
  spaceName: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation(['admin']);
  const f = useFormatters();
  const done = useDone();
  const [pending, setPending] = useState<Pending | null>(null);
  const [parts, setParts] = useState<SpaceRemovablePart[]>([]);
  const [listing, setListing] = useState<AdminSpaceExpressions | null>(null);
  const [error, setError] = useState('');

  const loadListing = useCallback(async () => {
    try {
      setListing(await api.admin.spaceExpressions(spaceId));
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, [spaceId]);

  useEffect(() => {
    setListing(null);
    void loadListing();
  }, [loadListing]);

  const empty = listing !== null && listing.emojis.length + listing.stickers.length + listing.sounds.length === 0;
  const removeButton = (expression: SpaceExpressionKind, id: string, name: string) => (
    <button
      type="button"
      onClick={() => setPending({ kind: 'expression', expression, id, name })}
      aria-label={t('admin:removal.space.removeOne', { name })}
      data-tooltip={t('admin:removal.space.removeOne', { name })}
      className="icon-btn h-7 w-7 flex-shrink-0"
    >
      <Icon name="trash" size={14} />
    </button>
  );

  return (
    <>
      <section className="space-y-2.5">
        <h3 className="label-mono">{t('admin:removal.space.title')}</h3>
        <div className="surface-card space-y-3 rounded-lg p-4">
          <p className="text-meta text-txt-tertiary">{t('admin:removal.space.text')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setParts([]); setPending({ kind: 'parts' }); }} className="btn-outline btn-sm">
              {t('admin:removal.space.open')}
            </button>
            <button type="button" onClick={() => setPending({ kind: 'delete' })} className="btn-danger btn-sm">
              {t('admin:removal.space.deleteOpen')}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-2.5">
        <h3 className="label-mono">{t('admin:removal.space.expressions')}</h3>
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
        {empty && <p className="text-ui text-txt-tertiary">{t('admin:removal.space.expressionsEmpty')}</p>}
        {listing && !empty && (
          <ul className="divide-y divide-border-soft rounded-lg border border-border-soft">
            {listing.emojis.map((emoji) => (
              <li key={`emoji-${emoji.id}`} className="flex items-center gap-3 px-3 py-1.5">
                <img src={`/api/emojis/${emoji.id}.webp`} alt="" className="h-6 w-6 flex-shrink-0 object-contain" loading="lazy" />
                <span className="min-w-0 flex-1 truncate font-mono text-ui text-txt-primary">:{emoji.name}:</span>
                <span className="label-mono">{t('admin:removal.expressions.emoji')}</span>
                {removeButton('emoji', emoji.id, `:${emoji.name}:`)}
              </li>
            ))}
            {listing.stickers.map((sticker) => (
              <li key={`sticker-${sticker.id}`} className="flex items-center gap-3 px-3 py-1.5">
                <img src={`/api/stickers/assets/${sticker.stickerId}.webp`} alt="" className="h-8 w-8 flex-shrink-0 object-contain" loading="lazy" />
                <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{sticker.name}</span>
                <span className="label-mono">{t('admin:removal.expressions.sticker')}</span>
                {removeButton('sticker', sticker.id, sticker.name)}
              </li>
            ))}
            {listing.sounds.map((sound) => (
              <li key={`sound-${sound.id}`} className="flex items-center gap-3 px-3 py-1.5">
                <Icon name="volume" size={16} className="flex-shrink-0 text-txt-tertiary" />
                <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{sound.name}</span>
                <span className="tabular font-mono text-meta text-txt-tertiary">{f.formatDuration(Math.max(1, Math.round(sound.duration)))}</span>
                <span className="label-mono">{t('admin:removal.expressions.sound')}</span>
                {removeButton('sound', sound.id, sound.name)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending?.kind === 'parts' && (
        <AdminRemovalDialog
          title={t('admin:removal.space.title')}
          text={t('admin:removal.space.text')}
          canSubmit={parts.length > 0}
          onRemove={async (removal) => {
            await api.admin.removeSpaceContent(spaceId, { ...removal, parts });
            done();
            onChanged();
          }}
          onClose={() => setPending(null)}
        >
          <PartChoices
            legend={t('admin:removal.space.title')}
            parts={SPACE_REMOVABLE_PARTS}
            chosen={parts}
            label={(part) => t(`admin:removal.spaceParts.${part}`)}
            onChange={setParts}
          />
        </AdminRemovalDialog>
      )}
      {pending?.kind === 'expression' && (
        <AdminRemovalDialog
          title={t('admin:removal.space.removeOne', { name: pending.name })}
          text={t('admin:removal.space.removeOneText')}
          onRemove={async (removal) => {
            await api.admin.removeSpaceExpression(spaceId, { ...removal, kind: pending.expression, id: pending.id });
            done();
            await loadListing();
          }}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'delete' && (
        <AdminRemovalDialog
          title={t('admin:removal.space.deleteTitle', { name: spaceName })}
          text={t('admin:removal.space.deleteText')}
          submitLabel={t('admin:removal.space.deleteSubmit')}
          onRemove={async (removal) => {
            await api.admin.deleteSpace(spaceId, removal);
            done();
            onDeleted();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
