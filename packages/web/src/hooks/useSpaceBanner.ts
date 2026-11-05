import { useState } from 'react';
import { useGatedPicture } from '../components/ui/ExternalMedia';
import { uploadAddress } from '../utils/assetUrls';

/**
 * A space's banner as the page may show it now: its address when the space has one and the picture
 * may be fetched (`useGatedPicture`: a space's own instance is a connected origin, anything else
 * waits for a yes, docs/systems/legal.md), and null otherwise, or once it has failed to load, so the
 * caller shows what it shows without one. A banner that changes gets another try.
 */
export function useSpaceBanner(banner: string | null | undefined): { src: string | null; onError: () => void } {
  const shown = useGatedPicture(banner ? uploadAddress(banner) : null);
  const [failed, setFailed] = useState<string | null>(null);
  return {
    src: shown && shown !== failed ? shown : null,
    onError: () => setFailed(shown),
  };
}
