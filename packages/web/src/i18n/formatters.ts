import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createFormatters, type Formatters } from './createFormatters';
import i18n from './index';
import { useAppearanceStore } from '../stores/appearanceStore';

export { createFormatters, type Formatters, type IntervalUnitDisplay } from './createFormatters';

/** The app-wide formatters, bound to the selected language and the person's clock. */
export const formatters: Formatters = createFormatters(
  () => i18n.resolvedLanguage ?? i18n.language ?? 'en',
  () => useAppearanceStore.getState().timeFormat,
);

/**
 * The same formatters for components. Subscribes to language and clock changes
 * so a component re-renders with the new locale, or the other kind of clock,
 * when the user changes either. The object is a new one then, so whatever a
 * component memoised from it is worked out again.
 */
export function useFormatters(): Formatters {
  const { i18n: instance } = useTranslation();
  const language = instance.resolvedLanguage ?? instance.language;
  const clock = useAppearanceStore((s) => s.timeFormat);
  return useMemo(() => ({ ...formatters }), [language, clock]);
}
