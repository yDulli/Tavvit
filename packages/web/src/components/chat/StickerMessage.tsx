import { useTranslation } from 'react-i18next';
import { stickerUrl } from '@backspace/shared/src/stickers';
import { useUIStore } from '../../stores/uiStore';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { ExternalGate } from '../ui/ExternalMedia';

/**
 * A sticker message. A sticker of this instance, or of one this client is signed into, shows at
 * once; one from any other server waits for a yes, like any picture from elsewhere
 * (docs/systems/legal.md, "Content from other servers"): the image is fetched by the reader's
 * own client, so the server holding it learns their address and when they read.
 */
export function StickerMessage({ token }: { token: string }) {
  const { t } = useTranslation('chat');
  const openImagePreview = useUIStore(s => s.openImagePreview);
  const trustedOrigins = useConnectedOrigins();
  const url = stickerUrl(token)!;
  return (
    <ExternalGate url={url} trustedOrigins={trustedOrigins}>
      <div className="max-w-[240px]">
        <button type="button" onClick={() => openImagePreview(url)} aria-label={t('stickers.preview')}>
          <img data-sticker-source={token} src={url} alt={t('stickers.sticker')} className="max-w-full max-h-[240px] rounded-md object-contain" loading="lazy" />
        </button>
      </div>
    </ExternalGate>
  );
}
