import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { appearanceSettingsOf, useAppearanceStore } from '../../stores/appearanceStore';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { applyAccent } from '../../utils/instanceBranding';
import { applyAppearance, clearAppearance } from '../../utils/appTheme';

/**
 * Mounted once in App. Puts this device's appearance on the page: the surface
 * theme, the shape and light of the interface, the size of chat text and the
 * motion setting from the person's own choices, and the accent colour, which is
 * theirs when they chose one and the instance's otherwise. It renders nothing.
 *
 * It works on the sign-in page too, so a person's theme is there before the
 * first message loads.
 */
export function AppearanceController(): null {
  const appearance = useAppearanceStore(useShallow(appearanceSettingsOf));
  const instanceAccent = useHomeInstanceInfo()?.accentColor ?? null;

  useEffect(() => {
    applyAppearance(document.documentElement, appearance);
    return () => clearAppearance(document.documentElement);
  }, [appearance]);

  useEffect(() => {
    applyAccent(document.documentElement, appearance.accent ?? instanceAccent);
    return () => applyAccent(document.documentElement, null);
  }, [appearance.accent, instanceAccent]);

  return null;
}
