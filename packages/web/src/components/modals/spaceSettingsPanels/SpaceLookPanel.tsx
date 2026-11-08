import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { spaceLookOf, type SpaceLook } from '@backspace/shared/src/looks';
import { describeError } from '../../../i18n/errors';
import { appearanceSettingsOf, useAppearanceStore } from '../../../stores/appearanceStore';
import { useLooksStore } from '../../../stores/looksStore';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { lookOfAppearance, spaceLookOfLook } from '../../../utils/looks';
import { SurfaceSwatch } from '../../ui/SurfaceSwatch';
import { FormError, SettingsSection } from '../settingsPanels/_shared/SettingsControls';

function sameSpaceLook(a: SpaceLook | null, b: SpaceLook | null): boolean {
  if (!a || !b) return a === b;
  return a.hue === b.hue && a.strength === b.strength && a.depth === b.depth && a.accent === b.accent;
}

function surfaceOfSpaceLook(look: SpaceLook) {
  return { hue: look.hue, strength: look.strength, depth: look.depth };
}

/**
 * Space settings → Look (docs/systems/spaces.md, "A space's look"): the colours the space chooses
 * for itself, taken from one of the chooser's own looks (the one on now, or one kept in the theme
 * studio). Members see the space in them while they are in it, unless they turned that off; the
 * shape, the typeface and how messages sit stay each member's own. The server checks the colours
 * by the same rule (`spaceLookOf`).
 */
export function SpaceLookPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const navigate = useNavigate();
  const space = useSpaceStore((s) => s.spaces.find((entry) => entry.id === spaceId));
  const appearance = useAppearanceStore(useShallow(appearanceSettingsOf));
  const looks = useLooksStore((s) => s.looks);
  const stored = useMemo(() => spaceLookOf(space?.look), [space?.look]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!space) return null;

  const choices: Array<{ key: string; name: string; look: SpaceLook }> = [
    { key: 'mine', name: t('spaces:settings.look.mine'), look: spaceLookOfLook(lookOfAppearance(appearance)) },
    ...looks.map((saved) => ({ key: saved.id, name: saved.name, look: spaceLookOfLook(saved.look) })),
  ];

  const save = async (look: SpaceLook | null) => {
    setSaving(true);
    setError('');
    try {
      await useSpaceStore.getState().updateSpace(spaceId, { look });
      useUIStore.getState().addToast(t(look ? 'spaces:settings.look.saved' : 'spaces:settings.look.removed'), 'success', 2000);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const openStudio = () => {
    useUIStore.getState().closeModal();
    navigate('/studio');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('spaces:settings.look.title')}</h2>
        <p className="mt-1 text-ui leading-relaxed text-txt-secondary">{t('spaces:settings.look.intro')}</p>
      </div>

      <SettingsSection title={t('spaces:settings.look.current')}>
        {stored ? (
          <div className="flex flex-wrap items-center gap-3">
            <SurfaceSwatch settings={surfaceOfSpaceLook(stored)} accent={stored.accent} className="h-14 w-32" />
            <p className="min-w-0 flex-1 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.look.currentHint')}</p>
            <button type="button" onClick={() => void save(null)} disabled={saving} className="btn-outline btn-sm">
              {t('spaces:settings.look.remove')}
            </button>
          </div>
        ) : (
          <p className="text-ui text-txt-tertiary">{t('spaces:settings.look.none')}</p>
        )}
      </SettingsSection>

      <SettingsSection title={t('spaces:settings.look.choose')} description={t('spaces:settings.look.chooseHint')}>
        <ul className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
          {choices.map((choice) => {
            const chosen = sameSpaceLook(stored, choice.look);
            return (
              <li key={choice.key}>
                <button
                  type="button"
                  onClick={() => void save(choice.look)}
                  disabled={saving || chosen}
                  aria-pressed={chosen}
                  className={`w-full rounded-lg border p-2 text-left transition-colors duration-100 disabled:cursor-default ${
                    chosen ? 'border-accent-primary bg-accent-primary/[0.06]' : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover active:bg-interactive-active'
                  }`}
                >
                  <SurfaceSwatch settings={surfaceOfSpaceLook(choice.look)} accent={choice.look.accent} />
                  <span className="mt-2 block truncate px-0.5 text-ui font-medium text-txt-primary">{choice.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={openStudio} className="btn-quiet btn-sm">{t('spaces:settings.look.openStudio')}</button>
      </SettingsSection>

      {error && <FormError>{error}</FormError>}
    </div>
  );
}
