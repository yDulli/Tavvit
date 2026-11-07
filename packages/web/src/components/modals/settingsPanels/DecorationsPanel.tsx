import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '@backspace/shared';
import {
  AVATAR_FRAMES,
  NAME_EFFECTS,
  NAME_FONTS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  type DecorationsUpdate,
  type NameFont,
} from '@backspace/shared/src/decorations';
import { customDecorationRef, type CustomDecorationKind, type CustomDecorationRef } from '@backspace/shared/src/customDecorations';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { cssUrl } from '../../../utils/cssUrl';
import {
  decorationColors,
  isMadeDesign,
  personDecorations,
  type EffectChoice,
  type FrameChoice,
  type NameEffectChoice,
  type NameplateChoice,
  type PersonDecorations,
} from '../../../utils/decorations';
import { getAvatarGradient } from '../../../utils/gradients';
import { bannerFill } from '../../../utils/placeLight';
import { bannerBackground, profileThemeOf } from '../../../utils/profileTheme';
import { Avatar } from '../../ui/Avatar';
import { DecoratedName, NameplateLayer, ProfileEffectLayer } from '../../ui/Decorations';
import { FormError, OptionCards, SegmentedControl, SettingsField, SettingsPage, type ChoiceOption } from './_shared/SettingsControls';
import { DesignPreview, type DesignChoice, type PreviewLook } from './decorations/DesignPreview';
import { CommunityGallery, MyDesigns } from './decorations/MadeDesigns';

const NONE = 'none';

type Category = CustomDecorationKind;
const CATEGORIES: readonly Category[] = ['frame', 'effect', 'nameplate', 'name'];

/** Where the designs offered come from: Tavvit's own, the community's gallery, the person's own. */
type Source = 'tavvit' | 'community' | 'mine';
const SOURCES: readonly Source[] = ['tavvit', 'community', 'mine'];

/** What the person tries on: Tavvit's designs by name, or designs someone made. */
interface Trying {
  frame: FrameChoice | null;
  effect: EffectChoice | null;
  nameplate: NameplateChoice | null;
  font: NameFont | null;
  nameEffect: NameEffectChoice | null;
}

/** The field each category tries a design on in. */
const FIELD_OF: Readonly<Record<Category, 'frame' | 'effect' | 'nameplate' | 'nameEffect'>> = {
  frame: 'frame',
  effect: 'effect',
  nameplate: 'nameplate',
  name: 'nameEffect',
};

/** Tavvit's designs of each kind, "none" first. */
const BUILT_IN: Readonly<Record<Category, readonly string[]>> = {
  frame: [NONE, ...AVATAR_FRAMES],
  effect: [NONE, ...PROFILE_EFFECTS],
  nameplate: [NONE, ...NAMEPLATES],
  name: [NONE, ...NAME_EFFECTS],
};

/** Where each kind's labels are in the catalog. */
const LABELS: Readonly<Record<Category, string>> = { frame: 'frames', effect: 'effects', nameplate: 'nameplates', name: 'nameEffects' };

/** How a choice is stored and compared: a design's name, or a made design's reference. */
function keyOf(choice: DesignChoice | null): string | null {
  if (choice === null) return null;
  return isMadeDesign(choice) ? customDecorationRef(choice.id) : choice;
}

function tryingOf(decorations: PersonDecorations): Trying {
  return {
    frame: decorations.avatarFrame,
    effect: decorations.profileEffect,
    nameplate: decorations.nameplate,
    font: decorations.nameFont,
    nameEffect: decorations.nameEffect,
  };
}

function lookOf(user: User): PreviewLook {
  const name = user.displayName?.trim() || user.username;
  const tile = getAvatarGradient(user.homeUserId ?? user.id, name, user.avatarColor);
  const theme = profileThemeOf(user);
  return {
    user,
    name,
    banner: user.banner
      ? { backgroundImage: cssUrl(user.banner.startsWith('http') ? user.banner : api.uploads.url(user.banner)), backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: theme ? bannerBackground(theme) : bannerFill(tile.from) },
    colors: decorationColors(user, tile),
  };
}

/** The three places a decoration shows: the profile, a member list, a conversation. */
function Preview({ look, trying }: { look: PreviewLook; trying: Trying }) {
  const { t } = useTranslation(['settings', 'common']);
  const name = (motion: 'on' | 'hover') => (
    <DecoratedName font={trying.font} effect={trying.nameEffect} colors={look.colors} motion={motion}>{look.name}</DecoratedName>
  );
  return (
    <div className="grid gap-3 desktop:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="relative isolate overflow-hidden rounded-lg border border-border-hard bg-surface-elevated">
        <div className="h-[84px]" style={look.banner} />
        <div className="px-4 pb-4">
          <div className="mt-[-34px] mb-2">
            <Avatar
              src={look.user.avatar}
              name={look.name}
              size={60}
              userId={look.user.homeUserId ?? look.user.id}
              user={look.user}
              status="online"
              ring={{ width: 4, color: 'rgb(var(--bg-elevated))' }}
              frame={trying.frame}
              frameMotion="on"
            />
          </div>
          <div className="truncate text-lead font-semibold leading-tight text-txt-primary">{name('on')}</div>
          <div className="truncate text-meta text-txt-tertiary">@{look.user.username}</div>
        </div>
        <ProfileEffectLayer effect={trying.effect} className="z-20" />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="space-y-1.5">
          <div className="label-mono">{t('settings:decorations.preview.list')}</div>
          <div className="relative isolate flex items-center gap-2.5 overflow-hidden rounded-md border border-border-hard bg-surface-channel px-2.5 py-2">
            <NameplateLayer nameplate={trying.nameplate} colors={look.colors} />
            <Avatar src={look.user.avatar} name={look.name} size={32} userId={look.user.homeUserId ?? look.user.id} user={look.user} status="online" frame={trying.frame} frameMotion="on" />
            <span className="min-w-0">
              <span className="block truncate text-ui font-medium leading-[1.2] text-txt-primary">{name('on')}</span>
              <span className="block truncate text-label leading-[1.3] text-txt-tertiary">{t('common:states.online')}</span>
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="label-mono">{t('settings:decorations.preview.chat')}</div>
          <div className="deco-hover flex gap-3 rounded-md border border-border-hard bg-surface-chat px-3 py-2.5">
            <Avatar src={look.user.avatar} name={look.name} size={36} userId={look.user.homeUserId ?? look.user.id} user={look.user} frame={trying.frame} frameMotion="hover" />
            <div className="min-w-0">
              <div className="truncate text-body font-semibold leading-tight text-txt-primary">{name('hover')}</div>
              <p className="mt-0.5 text-body leading-snug text-txt-secondary">{t('settings:decorations.preview.message')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Decorations (docs/systems/decorations.md): a frame for the picture, an effect over the
 * profile, a nameplate in lists and a style for the name, each tried on in the preview before it is
 * chosen. Free for everyone: Tavvit's own designs, the community's gallery of designs people made
 * and shared, and the person's own, which they make here.
 */
export function DecorationsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const addToast = useUIStore((s) => s.addToast);
  const categoryLabel = useId();
  const sourceLabel = useId();
  const pickerLabel = useId();
  const fontLabel = useId();
  const stored = personDecorations(user, user?.displayName?.trim() || user?.username || '');
  const storedKey = [keyOf(stored.avatarFrame), keyOf(stored.profileEffect), keyOf(stored.nameplate), stored.nameFont, keyOf(stored.nameEffect)].join('|');
  const [category, setCategory] = useState<Category>('frame');
  const [sources, setSources] = useState<Record<Category, Source>>({ frame: 'tavvit', effect: 'tavvit', nameplate: 'tavvit', name: 'tavvit' });
  const [trying, setTrying] = useState<Trying>(() => tryingOf(stored));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // What is stored changed (this save, or another device's): the choices start from it again.
  const [seenKey, setSeenKey] = useState(storedKey);
  if (seenKey !== storedKey) {
    setSeenKey(storedKey);
    setTrying(tryingOf(stored));
  }

  if (!user) return null;
  const look = lookOf(user);
  const source = sources[category];
  const field = FIELD_OF[category];
  const current = trying[field];

  const tryOn = (kind: Category, choice: DesignChoice | null) => {
    setTrying((now) => ({ ...now, [FIELD_OF[kind]]: choice }));
  };
  // A design that went lets go of whatever tried it on.
  const gone = (id: string) => {
    setTrying((now) => {
      const next = { ...now };
      for (const key of ['frame', 'effect', 'nameplate', 'nameEffect'] as const) {
        const choice = next[key];
        if (isMadeDesign(choice) && choice.id === id) next[key] = null;
      }
      return next;
    });
  };

  const wire = (choice: DesignChoice | null) => keyOf(choice) as CustomDecorationRef | null;
  const changes: DecorationsUpdate = {};
  if (keyOf(trying.frame) !== keyOf(stored.avatarFrame)) changes.avatarFrame = wire(trying.frame) as DecorationsUpdate['avatarFrame'];
  if (keyOf(trying.effect) !== keyOf(stored.profileEffect)) changes.profileEffect = wire(trying.effect) as DecorationsUpdate['profileEffect'];
  if (keyOf(trying.nameplate) !== keyOf(stored.nameplate)) changes.nameplate = wire(trying.nameplate) as DecorationsUpdate['nameplate'];
  if (trying.font !== stored.nameFont) changes.nameFont = trying.font;
  if (keyOf(trying.nameEffect) !== keyOf(stored.nameEffect)) changes.nameEffect = wire(trying.nameEffect) as DecorationsUpdate['nameEffect'];
  const hasChanges = Object.keys(changes).length > 0;

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await updateProfile(changes);
      addToast(t('settings:account.save.updated'), 'success', 2000);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('settings:account.save.failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setTrying(tryingOf(stored));
    setError('');
  };

  const option = (id: string, label: string, preview: ReactNode): ChoiceOption<string> => ({ id, label, preview });
  const builtInValue = current !== null && !isMadeDesign(current) ? current : NONE;
  const hints: Record<Category, string> = {
    frame: t('settings:decorations.frameHint'),
    effect: t('settings:decorations.effectHint'),
    nameplate: t('settings:decorations.nameplateHint'),
    name: t('settings:decorations.nameEffectHint'),
  };
  const designsProps = {
    kind: category,
    look,
    font: trying.font,
    selectedId: isMadeDesign(current) ? current.id : null,
    onSelect: (design: DesignChoice) => tryOn(category, design),
    onGone: gone,
  };

  let designs: ReactNode;
  if (source === 'community') {
    designs = <CommunityGallery key={category} {...designsProps} />;
  } else if (source === 'mine') {
    designs = <MyDesigns key={category} {...designsProps} />;
  } else {
    designs = (
      <OptionCards
        labelledBy={pickerLabel}
        value={builtInValue}
        onChange={(id) => tryOn(category, id === NONE ? null : (id as DesignChoice))}
        columns={category === 'nameplate' ? 3 : 4}
        options={BUILT_IN[category].map((id) => option(
          id,
          t(`settings:decorations.${LABELS[category]}.${id}` as 'settings:decorations.frames.none'),
          <DesignPreview kind={category} design={id === NONE ? null : (id as DesignChoice)} look={look} font={trying.font} />,
        ))}
      />
    );
  }

  return (
    <SettingsPage title={t('settings:decorations.title')} intro={t('settings:decorations.intro')}>
      {/* The preview stays in view while the choices scroll under it. */}
      <div className="z-10 -mx-6 border-b border-border-hard bg-surface-chat px-6 pb-4 pt-2 desktop:sticky desktop:top-[-32px]">
        <Preview look={look} trying={trying} />
      </div>
      <div className="space-y-5">
        <div>
          <div id={categoryLabel} className="sr-only">{t('settings:decorations.categories.label')}</div>
          <SegmentedControl
            labelledBy={categoryLabel}
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((id) => ({ id, label: t(`settings:decorations.categories.${id}`) }))}
          />
        </div>

        {category === 'name' && (
          <SettingsField label={t('settings:decorations.nameFont')} hint={t('settings:decorations.nameFontHint')} labelId={fontLabel}>
            <OptionCards
              labelledBy={fontLabel}
              value={trying.font ?? 'classic'}
              onChange={(id) => setTrying((now) => ({ ...now, font: id === 'classic' ? null : id }))}
              columns={4}
              options={NAME_FONTS.map((id) => ({
                id,
                label: t(`settings:decorations.fonts.${id}`),
                preview: (
                  <DecoratedName font={id === 'classic' ? null : id} effect={null} colors={look.colors} className="truncate px-2 text-ui font-semibold text-txt-primary">
                    {look.name}
                  </DecoratedName>
                ),
              }))}
            />
          </SettingsField>
        )}

        <SettingsField
          label={category === 'name' ? t('settings:decorations.nameEffect') : t(`settings:decorations.categories.${category}`)}
          hint={hints[category]}
          labelId={pickerLabel}
        >
          <div className="space-y-3">
            <div>
              <div id={sourceLabel} className="sr-only">{t('settings:decorations.sources.label')}</div>
              <SegmentedControl
                labelledBy={sourceLabel}
                value={source}
                onChange={(next) => setSources((now) => ({ ...now, [category]: next }))}
                options={SOURCES.map((id) => ({ id, label: t(`settings:decorations.sources.${id}`) }))}
              />
            </div>
            {designs}
          </div>
        </SettingsField>
      </div>

      {/* What is unsaved, and what went wrong saving it, stay in view while the choices scroll. */}
      {(error || hasChanges) && (
        <div className="pointer-events-none sticky bottom-0 z-10 space-y-2 pb-1 pt-3">
          {error && (
            <div className="pointer-events-auto bg-surface-chat">
              <FormError>{error}</FormError>
            </div>
          )}
          {hasChanges && (
            <div className="flex justify-center">
              <div className="action-bar pointer-events-auto animate-slide-up">
                <button type="button" onClick={handleReset} className="btn-quiet">
                  {t('common:actions.reset')}
                </button>
                <button type="button" onClick={handleSave} disabled={saving} aria-busy={saving} className="btn-primary">
                  {saving ? t('common:states.saving') : t('common:actions.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
