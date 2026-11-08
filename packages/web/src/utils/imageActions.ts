import i18n from '../i18n';
import { useUIStore } from '../stores/uiStore';
import { useTransferStore } from '../stores/transferStore';

function deriveFilename(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split('/').pop() || 'image';
    return last.split('?')[0] || 'image';
  } catch {
    return url.split('/').pop()?.split('?')[0] ?? 'image';
  }
}

/**
 * Downloads an image via the transfer manager. Falls back to opening in a new
 * tab if the transfer pipeline can't fetch the URL (e.g., CORS).
 */
export async function saveImage(url: string, filename?: string): Promise<void> {
  const fname = filename ?? deriveFilename(url);

  try {
    const transferId = await useTransferStore.getState().startDownload(url, {
      filename: fname,
      mimetype: 'image/*',
      tray: true,
    });
    // startDownload never throws on user-cancel — it sets state to 'aborted'
    // and resolves with the id. Detect that and stay silent.
    const t = useTransferStore.getState().get(transferId);
    if (t?.state === 'failed') {
      throw new Error(t.error?.message ?? 'Download failed');
    }
  } catch {
    window.open(url, '_blank', 'noopener');
    useUIStore.getState().addToast('Opened in new tab', 'info', 3000);
  }
}

/**
 * Copies an image to the clipboard as PNG.
 * GIFs are copied as URL text to preserve animation (PNG conversion strips it).
 * Falls back to copying the URL as text if CORS or clipboard API blocks it.
 */
export async function copyImageToClipboard(url: string): Promise<void> {
  // GIFs lose animation when converted to PNG — copy the URL instead
  if (isGifUrl(url)) {
    await navigator.clipboard.writeText(url);
    useUIStore.getState().addToast('Copied GIF link', 'success', 3000);
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    // If the server returned a GIF despite the URL not ending in .gif
    if (blob.type === 'image/gif') {
      await navigator.clipboard.writeText(url);
      useUIStore.getState().addToast('Copied GIF link', 'success', 3000);
      return;
    }

    const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob }),
    ]);
  } catch {
    await navigator.clipboard.writeText(url);
    useUIStore.getState().addToast('Copied image link', 'info', 3000);
  }
}

/** Checks if a URL points to a GIF by extension or known GIF CDN patterns. */
function isGifUrl(url: string): boolean {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.gif')) return true;
  // Tenor and Klipy serve GIFs even without .gif extension
  if (/media\.tenor\.com|static\.klipy\.com/.test(url)) return true;
  return false;
}

/** Draws a blob onto an offscreen canvas and exports as PNG. */
function convertToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(blobUrl);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('Canvas toBlob returned null'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Failed to load image for conversion'));
    };
    img.src = blobUrl;
  });
}

const BLOB_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/**
 * Copies a picture this page has read itself (`load`, e.g. through this server), as PNG. A GIF,
 * which would stand still as PNG, and anything that fails is copied as `link` instead.
 */
export async function copyImageFrom(load: () => Promise<Blob>, link: string): Promise<void> {
  try {
    const blob = await load();
    if (blob.type === 'image/gif') throw new Error('A GIF is copied as its link');
    const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    useUIStore.getState().addToast(i18n.t('chat:viewer.imageCopied'), 'success', 3000);
  } catch {
    await navigator.clipboard.writeText(link);
    useUIStore.getState().addToast(i18n.t('chat:viewer.linkCopied'), 'info', 3000);
  }
}

/**
 * Saves a picture this page has read itself (`load`) under `filename`, with the extension its type
 * names. When it cannot be read, the picture opens in a new tab, where the browser can save it.
 */
export async function saveImageFrom(load: () => Promise<Blob>, filename: string, fallbackUrl: string): Promise<void> {
  try {
    const blob = await load();
    const extension = BLOB_EXTENSIONS[blob.type];
    const name = extension && !filename.toLowerCase().endsWith(`.${extension}`) ? `${filename}.${extension}` : filename;
    const address = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = address;
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // The download has taken the file by the next turn; the address is not needed after.
    window.setTimeout(() => URL.revokeObjectURL(address), 1000);
  } catch {
    window.open(fallbackUrl, '_blank', 'noopener');
  }
}
