import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '@backspace/shared';
import {
  AVATAR_FRAMES,
  DECORATION_FIELDS,
  NAME_EFFECTS,
  NAME_FONTS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  decorationsOf,
  type AvatarFrame,
  type DecorationsUpdate,
  type NameEffect,
  type NameFont,
  type Nameplate,
  type ProfileDecorations,
  type ProfileEffect,
} from '@backspace/shared/src/decorations';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { cssUrl } from '../../../utils/cssUrl';
import { decorationColors } from '../../../utils/decorations';
import { getAvatarGradient } from '../../../utils/gradients';
import { bannerFill } from '../../../utils/placeLight';
import { bannerBackground, profileThemeOf } from '../../../utils/profileTheme';
import { Avatar } from '../../ui/Avatar';
import { DecoratedName, NameplateLayer, ProfileEffectLayer } from '../../ui/Decorations';
import { FormError, OptionCards, SegmentedControl, SettingsField, SettingsPage, type ChoiceOption } from './_shared/SettingsControls';

const NONE = 'none';
type Choice<T extends string> = T | typeof NONE;

const fromChoice = <T extends string>(choice: Choice<T>): T | null => (choice === NONE ? null : choice as T);

/** Each picker's choices, "none" first; the classic font is the name's "none". */
const FRAME_CHOICES: readonly Choice<AvatarFrame>[] = [NONE, ...AVATAR_FRAMES];
const EFFECT_CHOICES: readonly Choice<ProfileEffect>[] = [NONE, ...PROFILE_EFFECTS];
const NAMEPLATE_CHOICES: readonly Choice<Nameplate>[] = [NONE, ...NAMEPLATES];
const NAME_EFFECT_CHOICES: readonly Choice<NameEffect>[] = [NONE, ...NAME_EFFECTS];

type Category = 'frame' | 'effect' | 'nameplate' | 'name';
const CATEGORIES: readonly Category[] = ['frame', 'effect', 'nameplate', 'name'];

/** What the person tries on. */
interface Trying {
  frame: AvatarFrame | null;
  effect: ProfileEffect | null;
  nameplate: Nameplate | null;
  font: NameFont | null;
  nameEffect: NameEffect | null;
}

/** The person as the previews draw them. */
interface Look {
  user: User;
  name: string;
  banner: CSSProperties;
  colors: { a: string; b: string };
}

function lookOf(user: User): Look {
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
function Preview({ look, trying }: { look: Look; trying: Trying }) {
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
 * Settings → Decorations (docs/systems/decorations.md): a frame for the picture, an effect over
 * the banner, a nameplate in lists and a style for the name, each tried on in the preview before
 * it is chosen. Free for everyone; the designs are Tavvit's own and drawn from a name.
 */
export function DecorationsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const addToast = useUIStore((s) => s.addToast);
  const categoryLabel = useId();
  const pickerLabel = useId();
  const fontLabel = useId();
  const stored = decorationsOf(user);
  const storedKey = DECORATION_FIELDS.map((field) => stored[field] ?? '').join('|');
  const [category, setCategory] = useState<Category>('frame');
  const [frame, setFrame] = useState<Choice<AvatarFrame>>(stored.avatarFrame ?? NONE);
  const [effect, setEffect] = useState<Choice<ProfileEffect>>(stored.profileEffect ?? NONE);
  const [nameplate, setNameplate] = useState<Choice<Nameplate>>(stored.nameplate ?? NONE);
  const [font, setFont] = useState<NameFont>(stored.nameFont ?? 'classic');
  const [nameEffect, setNameEffect] = useState<Choice<NameEffect>>(stored.nameEffect ?? NONE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetTo = (source: ProfileDecorations) => {
    setFrame(source.avatarFrame ?? NONE);
    setEffect(source.profileEffect ?? NONE);
    setNameplate(source.nameplate ?? NONE);
    setFont(source.nameFont ?? 'classic');
    setNameEffect(source.nameEffect ?? NONE);
  };

  // What is stored changed (this save, or another device's): the choices start from it again.
  const [seenKey, setSeenKey] = useState(storedKey);
  if (seenKey !== storedKey) {
    setSeenKey(storedKey);
    resetTo(stored);
  }

  if (!user) return null;
  const look = lookOf(user);
  const trying: Trying = {
    frame: fromChoice(frame),
    effect: fromChoice(effect),
    nameplate: fromChoice(nameplate),
    font: font === 'classic' ? null : font,
    nameEffect: fromChoice(nameEffect),
  };
  const changes: DecorationsUpdate = {};
  if (trying.frame !== stored.avatarFrame) changes.avatarFrame = trying.frame;
  if (trying.effect !== stored.profileEffect) changes.profileEffect = trying.effect;
  if (trying.nameplate !== stored.nameplate) changes.nameplate = trying.nameplate;
  if (trying.font !== stored.nameFont) changes.nameFont = trying.font;
  if (trying.nameEffect !== stored.nameEffect) changes.nameEffect = trying.nameEffect;
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
    resetTo(stored);
    setError('');
  };

  const option = <T extends string>(id: T, label: string, preview: ReactNode): ChoiceOption<T> => ({ id, label, preview });
  const avatarProps = { src: user.avatar, name: look.name, userId: user.homeUserId ?? user.id, user };

  let picker: ReactNode;
  switch (category) {
    case 'frame':
      picker = (
        <SettingsField label={t('settings:decorations.categories.frame')} hint={t('settings:decorations.frameHint')} labelId={pickerLabel}>
          <OptionCards
            labelledBy={pickerLabel}
            value={frame}
            onChange={setFrame}
            columns={4}
            options={FRAME_CHOICES.map((id) => option(id, t(`settings:decorations.frames.${id}`), (
              <Avatar {...avatarProps} size={32} frame={fromChoice<AvatarFrame>(id)} frameMotion="on" />
            )))}
          />
        </SettingsField>
      );
      break;
    case 'effect':
      picker = (
        <SettingsField label={t('settings:decorations.categories.effect')} hint={t('settings:decorations.effectHint')} labelId={pickerLabel}>
          <OptionCards
            labelledBy={pickerLabel}
            value={effect}
            onChange={setEffect}
            columns={4}
            options={EFFECT_CHOICES.map((id) => option(id, t(`settings:decorations.effects.${id}`), (
              <span className="relative block h-full w-full" style={{ ...look.banner, '--deco-scale': 0.5 } as CSSProperties}>
                <ProfileEffectLayer effect={fromChoice<ProfileEffect>(id)} />
              </span>
            )))}
          />
        </SettingsField>
      );
      break;
    case 'nameplate':
      picker = (
        <SettingsField label={t('settings:decorations.categories.nameplate')} hint={t('settings:decorations.nameplateHint')} labelId={pickerLabel}>
          <OptionCards
            labelledBy={pickerLabel}
            value={nameplate}
            onChange={setNameplate}
            columns={3}
            options={NAMEPLATE_CHOICES.map((id) => option(id, t(`settings:decorations.nameplates.${id}`), (
              <span className="relative isolate flex h-full w-full items-center gap-2 bg-surface-channel px-2.5">
                <NameplateLayer nameplate={fromChoice<Nameplate>(id)} colors={look.colors} />
                <Avatar {...avatarProps} size={22} />
                <span className="truncate text-meta font-medium text-txt-primary">{look.name}</span>
              </span>
            )))}
          />
        </SettingsField>
      );
      break;
    case 'name':
      picker = (
        <>
          <SettingsField label={t('settings:decorations.nameFont')} hint={t('settings:decorations.nameFontHint')} labelId={fontLabel}>
            <OptionCards
              labelledBy={fontLabel}
              value={font}
              onChange={setFont}
              columns={4}
              options={NAME_FONTS.map((id) => option(id, t(`settings:decorations.fonts.${id}`), (
                <DecoratedName font={id === 'classic' ? null : id} effect={null} colors={look.colors} className="truncate px-2 text-ui font-semibold text-txt-primary">
                  {look.name}
                </DecoratedName>
              )))}
            />
          </SettingsField>
          <SettingsField label={t('settings:decorations.nameEffect')} hint={t('settings:decorations.nameEffectHint')} labelId={pickerLabel}>
            <OptionCards
              labelledBy={pickerLabel}
              value={nameEffect}
              onChange={setNameEffect}
              columns={4}
              options={NAME_EFFECT_CHOICES.map((id) => option(id, t(`settings:decorations.nameEffects.${id}`), (
                <DecoratedName font={trying.font} effect={fromChoice<NameEffect>(id)} colors={look.colors} className="truncate px-2 text-ui font-semibold text-txt-primary">
                  {look.name}
                </DecoratedName>
              )))}
            />
          </SettingsField>
        </>
      );
      break;
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
        {picker}
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
