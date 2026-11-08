import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore, type MediaViewerItem, type MediaViewerState } from '../../stores/uiStore';
import { copyImageFrom, copyImageToClipboard, saveImage, saveImageFrom } from '../../utils/imageActions';
import { webAddress } from '../../utils/webAddress';
import { isElectron } from '../../platform/platform';
import { Icon, type IconName } from '../ui/Icon';

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
/** One step of the zoom buttons, the keys and the wheel. */
const ZOOM_STEP = 1.25;
/** What a double click zooms to. */
const ZOOM_CLOSER = 2.5;

interface Pan {
  x: number;
  y: number;
}

/** How a picture is shown: how far zoomed in, and how far moved from the middle. */
interface View {
  zoom: number;
  pan: Pan;
}

const RESTING: View = { zoom: ZOOM_MIN, pan: { x: 0, y: 0 } };

/** `view` zoomed to `next`, keeping the point at `at` (relative to the stage's middle) where it is. */
function zoomed(view: View, next: number, at: Pan = { x: 0, y: 0 }): View {
  const zoom = Math.min(Math.max(next, ZOOM_MIN), ZOOM_MAX);
  if (zoom === ZOOM_MIN) return RESTING;
  const ratio = zoom / view.zoom;
  return { zoom, pan: { x: at.x - (at.x - view.pan.x) * ratio, y: at.y - (at.y - view.pan.y) * ratio } };
}

/**
 * The media viewer: one picture, or a message's pictures with a strip to move between them
 * (docs/systems/embeds.md, "The media viewer"). It opens over everything (`activeModal:
 * 'imagePreview'`) and closes with its X, Escape or a click beside the picture. The arrows and
 * the arrow keys move along, the zoom buttons, + and -, the wheel and a double click zoom in and
 * out, and a zoomed picture is moved by dragging it.
 */
export function MediaViewer() {
  const viewer = useUIStore((s) => (s.activeModal === 'imagePreview' ? s.mediaViewer : null));
  const close = useUIStore((s) => s.closeImagePreview);
  if (!viewer || viewer.items.length === 0) return null;
  return <ViewerFrame viewer={viewer} onClose={close} />;
}

function ViewerFrame({ viewer, onClose }: { viewer: MediaViewerState; onClose: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const total = viewer.items.length;
  const many = total > 1;
  const [index, setIndex] = useState(() => Math.min(Math.max(viewer.index, 0), total - 1));
  const [view, setView] = useState<View>(RESTING);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; from: Pan } | null>(null);
  const item: MediaViewerItem = viewer.items[index] ?? viewer.items[0]!;
  const { zoom, pan } = view;

  // A new set of pictures starts where it was opened.
  useEffect(() => {
    setIndex(Math.min(Math.max(viewer.index, 0), total - 1));
    setView(RESTING);
  }, [viewer, total]);

  const go = useCallback((next: number) => {
    setIndex(((next % total) + total) % total);
    setView(RESTING);
  }, [total]);

  const zoomTo = useCallback((next: (current: number) => number, at?: Pan) => {
    setView((current) => zoomed(current, next(current.zoom), at));
  }, []);

  /** A pointer's place relative to the stage's middle, where an unmoved picture's middle is. */
  const pointFrom = useCallback((clientX: number, clientY: number): Pan => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (many && event.key === 'ArrowRight') {
        event.preventDefault();
        go(index + 1);
      } else if (many && event.key === 'ArrowLeft') {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomTo((current) => current * ZOOM_STEP);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomTo((current) => current / ZOOM_STEP);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, many, onClose, zoomTo]);

  // The wheel zooms; it is a native listener because React's is passive and cannot keep the page still.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = pointFrom(event.clientX, event.clientY);
      zoomTo((current) => (event.deltaY < 0 ? current * ZOOM_STEP : current / ZOOM_STEP), at);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [pointFrom, zoomTo]);

  const pageUrl = webAddress(item.pageUrl ?? item.url) ?? item.url;
  const filename = item.filename ?? 'image';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      useUIStore.getState().addToast(t('chat:viewer.linkCopied'), 'success', 3000);
    } catch {
      useUIStore.getState().addToast(t('chat:viewer.copyFailed'), 'warning', 3000);
    }
  };
  const copyPicture = () => {
    if (item.loadFile) void copyImageFrom(item.loadFile, pageUrl);
    else void copyImageToClipboard(item.url);
  };
  const savePicture = () => {
    if (item.loadFile) void saveImageFrom(item.loadFile, filename, item.url);
    else void saveImage(item.url, item.filename ?? undefined);
  };
  const leaveFor = (action: (() => void) | undefined) => (action ? () => { onClose(); action(); } : undefined);

  const actions: Array<{ icon: IconName; label: string; onClick: () => void } | null> = [
    { icon: 'external', label: t('chat:viewer.openInBrowser'), onClick: () => window.open(pageUrl, '_blank', 'noopener,noreferrer') },
    { icon: 'link', label: t('chat:viewer.copyLink'), onClick: () => void copyLink() },
    { icon: 'copy', label: t('chat:preview.copy'), onClick: copyPicture },
    { icon: 'download', label: t('chat:preview.save'), onClick: savePicture },
    zoom > ZOOM_MIN
      ? { icon: 'zoom-out', label: t('chat:viewer.zoomOut'), onClick: () => zoomTo(() => ZOOM_MIN) }
      : { icon: 'zoom-in', label: t('chat:viewer.zoomIn'), onClick: () => zoomTo(() => ZOOM_CLOSER) },
    viewer.onReply ? { icon: 'reply', label: t('chat:viewer.reply'), onClick: leaveFor(viewer.onReply)! } : null,
    viewer.onForward ? { icon: 'forward', label: t('chat:viewer.forward'), onClick: leaveFor(viewer.onForward)! } : null,
  ];

  // A zoomed picture is moved by dragging it.
  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (zoom <= ZOOM_MIN || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: pan };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = { x: drag.from.x + event.clientX - drag.startX, y: drag.from.y + event.clientY - drag.startY };
    setView((current) => ({ ...current, pan: moved }));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  // Fixed positioning escapes App's 32px title bar and 1px divider. Keep the
  // viewer below that native-control area without changing browser layout.
  const topInsetClass = isElectron() ? 'top-[var(--titlebar-inset)]' : 'top-0';
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('chat:viewer.label')}
      className={`fixed inset-x-0 bottom-0 z-[200] flex flex-col bg-black/85 animate-fade-in ${topInsetClass}`}
      onClick={onClose}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <span className="label-mono pt-2.5 text-white/70" aria-live="polite">
          {many ? t('chat:viewer.position', { index: index + 1, total }) : ''}
        </span>
        <div className="glass flex flex-wrap items-center justify-end gap-px rounded-lg p-0.5" onClick={stop}>
          {actions.map((action) => action && (
            <button
              key={action.icon}
              type="button"
              onClick={action.onClick}
              aria-label={action.label}
              data-tooltip={action.label}
              className="icon-btn icon-btn-lg text-txt-secondary"
            >
              <Icon name={action.icon} size={18} />
            </button>
          ))}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common:actions.close')}
            data-tooltip={t('common:actions.close')}
            className="icon-btn icon-btn-lg text-txt-secondary"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 desktop:px-16">
        {many && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); go(index - 1); }}
            aria-label={t('chat:viewer.previous')}
            className="glass icon-btn icon-btn-lg absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-lg text-txt-secondary"
          >
            <Icon name="chevron-left" size={20} />
          </button>
        )}
        <img
          key={item.url}
          src={item.url}
          alt={item.alt || t('chat:preview.alt')}
          draggable={false}
          onClick={stop}
          onDoubleClick={(event) => zoomTo((current) => (current > ZOOM_MIN ? ZOOM_MIN : ZOOM_CLOSER), pointFrom(event.clientX, event.clientY))}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`max-h-full max-w-full select-none rounded-lg object-contain ${zoom > ZOOM_MIN ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform var(--dur-fast) var(--ease-out)',
            touchAction: zoom > ZOOM_MIN ? 'none' : 'auto',
          }}
        />
        {many && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); go(index + 1); }}
            aria-label={t('chat:viewer.next')}
            className="glass icon-btn icon-btn-lg absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg text-txt-secondary"
          >
            <Icon name="chevron-right" size={20} />
          </button>
        )}
      </div>

      {item.alt && (
        <p className="mx-auto max-w-2xl px-4 pt-2 text-center text-meta leading-snug text-white/75 line-clamp-3" onClick={stop}>
          {item.alt}
        </p>
      )}

      {many ? (
        <div
          role="group"
          aria-label={t('chat:viewer.strip')}
          className="glass mx-auto mb-4 mt-3 flex max-w-[calc(100%-2rem)] gap-1 overflow-x-auto rounded-lg p-1"
          onClick={stop}
        >
          {viewer.items.map((picture, at) => (
            <button
              key={`${picture.url}-${at}`}
              type="button"
              onClick={() => go(at)}
              aria-label={t('chat:viewer.show', { index: at + 1, total })}
              aria-current={at === index ? 'true' : undefined}
              className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md transition-opacity duration-100 ${at === index ? 'ring-2 ring-accent-primary' : 'opacity-60 hover:opacity-100'}`}
            >
              <img src={picture.thumb ?? picture.url} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}
