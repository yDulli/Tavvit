import { useEffect, useMemo } from 'react';
import { useMatch } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { spaceLookOf } from '@backspace/shared/src/looks';
import { appearanceSettingsOf, useAppearanceStore } from '../../stores/appearanceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { applyAccent } from '../../utils/instanceBranding';
import { applyAppearance, clearAppearance } from '../../utils/appTheme';
import { withSpaceLook } from '../../utils/looks';

/**
 * Mounted once in App. Puts this device's appearance on the page: the surface
 * theme, the shape and light of the interface, the size of chat text and the
 * motion setting from the person's own choices, and the accent colour, which is
 * theirs when they chose one and the instance's otherwise. It renders nothing.
 *
 * In a space that chose colours for itself (`Space.look`, read again with
 * `spaceLookOf` since another instance may have sent it), the space's surfaces
 * and accent take the place of the person's own while they are in it, unless
 * they turned that off, and never in the theme studio, where they shape their
 * own. Everything else stays theirs.
 *
 * It works on the sign-in page too, so a person's theme is there before the
 * first message loads.
 */
export function AppearanceController(): null {
  const appearance = useAppearanceStore(useShallow(appearanceSettingsOf));
  const instanceAccent = useHomeInstanceInfo()?.accentColor ?? null;
  const inStudio = useMatch('/studio') !== null;
  const storedSpaceLook = useSpaceStore((s) => (s.currentSpaceId ? s.spaces.find((space) => space.id === s.currentSpaceId)?.look : undefined));
  const spaceLook = useMemo(
    () => (appearance.spaceLooks && !inStudio ? spaceLookOf(storedSpaceLook) : null),
    [appearance.spaceLooks, inStudio, storedSpaceLook],
  );
  const shown = useMemo(() => (spaceLook ? withSpaceLook(appearance, spaceLook) : appearance), [appearance, spaceLook]);

  useEffect(() => {
    applyAppearance(document.documentElement, shown);
    return () => clearAppearance(document.documentElement);
  }, [shown]);

  useEffect(() => {
    applyAccent(document.documentElement, shown.accent ?? instanceAccent);
    return () => applyAccent(document.documentElement, null);
  }, [shown.accent, instanceAccent]);

  return null;
}
