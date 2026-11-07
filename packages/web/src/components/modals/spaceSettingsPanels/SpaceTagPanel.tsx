import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLE_GLYPH_GROUPS, ROLE_GLYPH_GROUP_IDS, type RoleGlyphId } from '@backspace/shared/src/roleGlyphs';
import { SPACE_TAG_COLORS, SPACE_TAG_LIMITS, checkSpaceTag, type SpaceTag, type SpaceTagColor } from '@backspace/shared/src/spaceTags';
import { describeError } from '../../../i18n/errors';
import { RoleGlyph } from '../../../roles/RoleIcon';
import { useAuthStore } from '../../../stores/authStore';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { Avatar } from '../../ui/Avatar';
import { SpaceTagMark } from '../../ui/SpaceTag';
import { FormError, SettingsField, SettingsSection, SWATCH_ROW, SwatchButton } from '../settingsPanels/_shared/SettingsControls';

/** The colour of a tag's swatch: the same token the tag is drawn in. */
const SWATCH: Record<SpaceTagColor, string> = {
  silver: 'rgb(var(--text-secondary))',
  mint: 'rgb(var(--accent-mint))',
  peach: 'rgb(var(--accent-peach))',
  lavender: 'rgb(var(--accent-lavender))',
  sky: 'rgb(var(--accent-sky))',
  amber: 'rgb(var(--accent-amber))',
  rose: 'rgb(var(--accent-rose))',
  coral: 'rgb(var(--accent-coral))',
};

/**
 * Space settings → Tag (docs/systems/space-tags.md): the short mark members can wear beside their
 * name. Letters, a symbol of the role set and a colour, shown as it will look; the server checks
 * the same rules (`checkSpaceTag`). Taking it away takes it off everyone wearing it.
 */
export function SpaceTagPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const textId = useId();
  const glyphLabel = useId();
  const colorLabel = useId();
  const space = useSpaceStore((s) => s.spaces.find((entry) => entry.id === spaceId));
  const me = useAuthStore((s) => s.user);
  const addToast = useUIStore((s) => s.addToast);
  const stored = space?.tag ?? null;
  const storedKey = stored ? `${stored.text}|${stored.glyph}|${stored.color}` : '';
  const [text, setText] = useState(stored?.text ?? '');
  const [glyph, setGlyph] = useState<RoleGlyphId>(stored?.glyph ?? 'star');
  const [color, setColor] = useState<SpaceTagColor>(stored?.color ?? 'lavender');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // What is stored changed (this save, or another admin's): the form starts from it again.
  const [seenKey, setSeenKey] = useState(storedKey);
  if (seenKey !== storedKey) {
    setSeenKey(storedKey);
    setText(stored?.text ?? '');
    if (stored) {
      setGlyph(stored.glyph);
      setColor(stored.color);
    }
  }

  if (!space) return null;

  const draft: SpaceTag = { text: text.trim(), glyph, color };
  const checked = checkSpaceTag(draft);
  const changed = !stored || stored.text !== draft.text || stored.glyph !== glyph || stored.color !== color;
  const myName = me?.displayName?.trim() || me?.username || '';

  const save = async (tag: SpaceTag | null) => {
    setSaving(true);
    setError('');
    try {
      await useSpaceStore.getState().updateSpace(spaceId, { tag });
      addToast(t(tag ? 'spaces:settings.tag.saved' : 'spaces:settings.tag.removed'), 'success', 2000);
      if (!tag) setText('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('spaces:settings.tag.title')}</h2>
        <p className="mt-1 text-ui leading-relaxed text-txt-secondary">{t('spaces:settings.tag.intro')}</p>
        {/* What a tag shows of a private space, said before anyone sets one (docs/systems/space-tags.md). */}
        {space.visibility === 'private' && (
          <p className="mt-3 rounded-md border border-border-soft bg-surface-input px-3 py-2 text-meta leading-relaxed text-txt-secondary">
            {t('spaces:settings.tag.privateNote')}
          </p>
        )}
      </div>

      <SettingsSection title={t('spaces:settings.tag.preview')}>
        <div className="flex items-center gap-2.5 rounded-md border border-border-hard bg-surface-chat px-3 py-2.5">
          <Avatar src={me?.avatar} name={myName} size={32} userId={me?.homeUserId ?? me?.id} user={me ?? undefined} />
          <span className="truncate text-body font-semibold text-txt-primary">{myName}</span>
          {checked.ok ? <SpaceTagMark tag={checked.tag} /> : <span className="text-meta text-txt-tertiary">{t('spaces:settings.tag.none')}</span>}
        </div>
      </SettingsSection>

      <SettingsField
        label={t('spaces:settings.tag.text')}
        hint={t('spaces:settings.tag.textHint', { min: SPACE_TAG_LIMITS.MIN_LENGTH, max: SPACE_TAG_LIMITS.MAX_LENGTH })}
        htmlFor={textId}
      >
        <input
          id={textId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={8}
          autoComplete="off"
          spellCheck={false}
          className="input-standard w-40 font-mono tracking-[0.06em]"
        />
      </SettingsField>

      <div>
        <div id={glyphLabel} className="field-label">{t('spaces:settings.tag.glyph')}</div>
        <div role="group" aria-labelledby={glyphLabel} className="max-h-[248px] overflow-y-auto rounded-md border border-border-soft bg-surface-input px-2 pb-2.5 scrollbar-thin">
          {ROLE_GLYPH_GROUP_IDS.map((group) => (
            <div key={group}>
              <div className="label-mono px-1 pb-1.5 pt-3">{t(`spaces:roleIcons.groups.${group}`)}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-0.5">
                {ROLE_GLYPH_GROUPS[group].map((id) => (
                  <button
                    data-tooltip=""
                    key={id}
                    type="button"
                    onClick={() => setGlyph(id)}
                    aria-pressed={glyph === id}
                    aria-label={t(`spaces:roleIcons.names.${id}`)}
                    className="role-glyph-option aria-pressed:bg-interactive-selected aria-pressed:text-txt-primary"
                  >
                    <RoleGlyph id={id} size={18} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div id={colorLabel} className="field-label">{t('spaces:settings.tag.color')}</div>
        <div role="group" aria-labelledby={colorLabel} className={SWATCH_ROW}>
          {SPACE_TAG_COLORS.map((id) => (
            <SwatchButton key={id} label={t(`common:colors.${id}`)} background={SWATCH[id]} selected={color === id} onClick={() => setColor(id)} />
          ))}
        </div>
      </div>

      <p className="text-meta leading-relaxed text-txt-tertiary">{t('spaces:settings.tag.wearersNote')}</p>

      {error && <FormError>{error}</FormError>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !checked.ok || !changed}
          aria-busy={saving}
          onClick={() => { if (checked.ok) void save(checked.tag); }}
        >
          {stored ? t('common:actions.save') : t('spaces:settings.tag.create')}
        </button>
        {stored && (
          <button type="button" className="btn-quiet" disabled={saving} onClick={() => void save(null)} title={t('spaces:settings.tag.removeHint')}>
            {t('spaces:settings.tag.remove')}
          </button>
        )}
      </div>
    </div>
  );
}
