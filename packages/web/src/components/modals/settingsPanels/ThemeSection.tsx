import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import {
  CARBON_SETTINGS,
  DEPTH_RANGE,
  HUE_RANGE,
  STRENGTH_RANGE,
  THEME_IDS,
  THEME_PRESETS,
  surfaceChannels,
  surfaceOf,
  type SurfaceSettings,
  type ThemeChoice,
} from '../../../utils/appTheme';
import { SettingsSection, SliderRow } from './_shared/SettingsControls';

/**
 * A theme as a little screen: the bar along the top, the sidebar with the row
 * you are on (its violet edge), the conversation and a floating card, each in
 * the theme's own surface colours, parted by the theme's own hairline.
 */
function Swatch({ settings }: { settings: SurfaceSettings }) {
  const rgb = (token: Parameters<typeof surfaceChannels>[1]) => `rgb(${surfaceChannels(settings, token).join(' ')})`;
  const hairline = rgb('--border-hard');
  return (
    <span className="flex h-14 flex-col overflow-hidden rounded-md border border-border-soft" aria-hidden="true">
      <span className="h-2.5 flex-shrink-0" style={{ backgroundColor: rgb('--bg-base'), borderBottom: `1px solid ${hairline}` }} />
      <span className="flex flex-1">
        <span className="relative w-1/4" style={{ backgroundColor: rgb('--bg-channel'), borderRight: `1px solid ${hairline}` }}>
          <span className="absolute inset-x-1 top-1.5 h-1.5 rounded-[1px] bg-white/[0.08]" />
          <span className="absolute left-1 top-1.5 h-1.5 w-[2px] bg-accent-primary" />
        </span>
        <span className="relative flex-1" style={{ backgroundColor: rgb('--bg-chat') }}>
          <span className="absolute left-1.5 top-1.5 h-1 w-8 rounded-[1px] bg-white/[0.14]" />
          <span className="absolute left-1.5 top-3.5 h-1 w-5 rounded-[1px] bg-white/[0.08]" />
          <span className="absolute bottom-1.5 right-1.5 h-3 w-8 rounded-[2px]" style={{ backgroundColor: rgb('--bg-elevated'), border: `1px solid ${rgb('--border-soft')}` }} />
        </span>
      </span>
    </span>
  );
}

const HUE_TRACK = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 359].map((h) => `hsl(${h} 70% 50%)`).join(', ')})`;

/**
 * The surface theme: Carbon (the graphite the app ships with), the ready-made
 * ones, and one of the person's own made from three sliders. A choice applies
 * at once; nothing here needs saving.
 */
export function ThemeSection() {
  const { t } = useTranslation('settings');
  const theme = useAppearanceStore((s) => s.theme);
  const custom = useAppearanceStore((s) => s.custom);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const setCustom = useAppearanceStore((s) => s.setCustom);

  const cards: ReadonlyArray<{ choice: ThemeChoice; settings: SurfaceSettings }> = [
    ...THEME_IDS.map((id) => ({
      choice: id as ThemeChoice,
      settings: id === 'carbon' ? CARBON_SETTINGS : THEME_PRESETS[id],
    })),
    { choice: 'custom', settings: custom },
  ];

  const editing = surfaceOf('custom', custom)!;

  return (
    <SettingsSection title={t('appearance.theme.title')} description={t('appearance.theme.description')}>
      <ul className="grid grid-cols-2 gap-2 desktop:grid-cols-4" aria-label={t('appearance.theme.title')}>
        {cards.map(({ choice, settings }) => {
          const selected = theme === choice;
          return (
            <li key={choice}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => (choice === 'custom' ? setCustom(custom) : setTheme(choice))}
                className={`w-full rounded-lg border p-2 text-left transition-colors duration-100 ${
                  selected ? 'border-accent-primary bg-accent-primary/[0.06]' : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover active:bg-interactive-active'
                }`}
              >
                <Swatch settings={settings} />
                <span className="mt-2 flex items-center gap-1.5 px-0.5">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 flex-shrink-0 rounded-full border ${selected ? 'border-accent-primary bg-accent-primary' : 'border-interactive-muted'}`}
                  />
                  <span className="min-w-0 truncate text-ui font-medium text-txt-primary">{t(`appearance.theme.name.${choice}`)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {theme === 'custom' && (
        <div className="space-y-4 border-t border-border-hard pt-4">
          <SliderRow
            id="theme-hue"
            label={t('appearance.theme.custom.hue')}
            value={editing.hue}
            min={HUE_RANGE.min}
            max={HUE_RANGE.max}
            step={1}
            track={HUE_TRACK}
            onChange={(hue) => setCustom({ ...editing, hue })}
          />
          <SliderRow
            id="theme-strength"
            label={t('appearance.theme.custom.strength')}
            value={editing.strength}
            min={STRENGTH_RANGE.min}
            max={STRENGTH_RANGE.max}
            step={1}
            onChange={(strength) => setCustom({ ...editing, strength })}
          />
          <SliderRow
            id="theme-depth"
            label={t('appearance.theme.custom.depth')}
            value={editing.depth}
            min={DEPTH_RANGE.min}
            max={DEPTH_RANGE.max}
            step={DEPTH_RANGE.step}
            onChange={(depth) => setCustom({ ...editing, depth })}
          />
          <button
            type="button"
            onClick={() => setTheme('carbon')}
            className="btn-outline btn-sm"
          >
            {t('appearance.theme.custom.reset')}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
