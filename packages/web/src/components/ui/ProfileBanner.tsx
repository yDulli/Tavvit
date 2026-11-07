import { cssUrl } from '../../utils/cssUrl';
import { useGatedPicture } from './ExternalMedia';

/**
 * A profile's banner: its picture once the page may fetch it (useGatedPicture), and the profile's
 * colours without one or until then, so a banner on a server this client does not talk to tells
 * that server nothing about who looked. The profile's effect lies over the whole card, not here
 * (`ProfileEffectLayer`, docs/systems/decorations.md).
 */
export function ProfileBanner({ src, fallback, className }: {
  src: string | null;
  fallback: string;
  className: string;
}) {
  const shown = useGatedPicture(src);
  return (
    <div
      className={`relative ${className}${shown ? '' : ' banner-depth'}`}
      style={shown
        ? { backgroundImage: cssUrl(shown), backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: fallback }
      }
    />
  );
}
