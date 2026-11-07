import type { ProfileEffect } from '@backspace/shared/src/decorations';
import { cssUrl } from '../../utils/cssUrl';
import { ProfileEffectLayer } from './Decorations';
import { useGatedPicture } from './ExternalMedia';

/**
 * A profile's banner: its picture once the page may fetch it (useGatedPicture), and the profile's
 * colours without one or until then, so a banner on a server this client does not talk to tells
 * that server nothing about who looked. The profile's effect, if it has one, plays over it
 * (docs/systems/decorations.md); `effectHeight` is the banner's height in pixels.
 */
export function ProfileBanner({ src, fallback, className, effect = null, effectHeight = 96 }: {
  src: string | null;
  fallback: string;
  className: string;
  effect?: ProfileEffect | null;
  effectHeight?: number;
}) {
  const shown = useGatedPicture(src);
  return (
    <div
      className={`relative ${className}${shown ? '' : ' banner-depth'}`}
      style={shown
        ? { backgroundImage: cssUrl(shown), backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: fallback }
      }
    >
      <ProfileEffectLayer effect={effect} height={effectHeight} />
    </div>
  );
}
