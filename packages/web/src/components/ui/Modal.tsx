import React, { useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useExitGhost } from '../../hooks/useExitGhost';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  size?: 'settings';
  /** Mobile display style: 'fullscreen' fills the screen, 'sheet' anchors to bottom, 'default' stays centered */
  mobileStyle?: 'fullscreen' | 'sheet' | 'default';
  /** False for a dialog that must be answered: no close button, no Escape, no click outside. */
  dismissible?: boolean;
}

/**
 * Shared dialog shell. It always renders through a portal into
 * `usePortalContainer()`, never in place. A `fixed inset-0` overlay is only
 * sized to the window while no ancestor sets `transform`, `filter` or
 * `backdrop-filter`; any of those makes the ancestor the containing block, and
 * the dialog is then sized and clipped to it (the 72px space strip is
 * `.glass-strip`, a dialog opened from its menu rendered inside the strip).
 * Callers mount a Modal wherever its state lives and do not portal it again.
 * Overlays stack by portal order: one opened from inside an open Modal is
 * appended after it.
 */
export function Modal(props: ModalProps) {
  const portalContainer = usePortalContainer();
  if (!props.isOpen) return null;
  return createPortal(<ModalSurface {...props} />, portalContainer);
}

/**
 * The dialogs open now, by the order they opened in. Escape closes only the
 * last one: a dialog opened from another (a decision from a space's detail,
 * the detail from the settings) must not take the ones behind it along.
 */
const openSurfaces = new Set<number>();
let lastSurfaceOrder = 0;

function ModalSurface({ onClose, title, children, maxWidth = 'max-w-md', size, mobileStyle = 'default', dismissible = true }: ModalProps) {
  const { t } = useTranslation('common');
  const isMobile = useUIStore((s) => s.isMobile);
  const closeLabel = size === 'settings' ? t('chrome.closeSettings') : t('actions.close');
  // Taken while rendering, where a dialog comes before one nested in it; the
  // effects of two that open together run the other way round.
  const [order] = useState(() => ++lastSurfaceOrder);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useExitGhost(surfaceRef);

  useEffect(() => {
    openSurfaces.add(order);
    return () => {
      openSurfaces.delete(order);
    };
  }, [order]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible && order === Math.max(...openSurfaces)) {
      onClose();
    }
  }, [dismissible, onClose, order]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Mobile fullscreen style
  if (isMobile && mobileStyle === 'fullscreen') {
    return (
      <div ref={surfaceRef} className="modal-whole fixed inset-0 z-[200] flex flex-col bg-surface-chat animate-fade-in">
        {(title || size === 'settings') && (
          <div className="panel-bar flex items-center justify-between gap-3 bg-surface-base pl-4 pr-1" style={{ paddingTop: 'var(--safe-top)' }}>
            {title ? <h2 className="truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">{title}</h2> : <div />}
            {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="icon-btn h-10 w-10"
              aria-label={closeLabel}
            >
              <Icon name="x" size={17} />
            </button>
            )}
          </div>
        )}
        <div className={`${size === 'settings' ? '' : 'p-4 overflow-y-auto scrollbar-thin'} flex-1 min-h-0`} style={size === 'settings' ? undefined : { paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          {children}
        </div>
      </div>
    );
  }

  // Mobile bottom sheet style
  if (isMobile && mobileStyle === 'sheet') {
    return (
      <div ref={surfaceRef} className="fixed inset-0 z-[200] flex items-end justify-center">
        <div
          className="modal-scrim absolute inset-0"
          onClick={dismissible ? onClose : undefined}
        />
        <div className="sheet-panel relative w-full max-h-[calc(85*var(--app-vh))] flex flex-col glass-modal rounded-t-lg" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          {title && (
            <div className="flex h-12 items-center justify-between gap-3 border-b border-border-hard pl-4 pr-1 flex-shrink-0">
              <h2 className="truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">{title}</h2>
              {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="icon-btn h-10 w-10"
                aria-label={closeLabel}
              >
                <Icon name="x" size={17} />
              </button>
              )}
            </div>
          )}
          <div className="p-4 overflow-y-auto scrollbar-thin flex-1 min-h-0">
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Settings size variant — large glass overlay for settings screens
  if (size === 'settings') {
    return (
      <div ref={surfaceRef} className="fixed inset-0 z-[200] flex items-center justify-center">
        <div
          className="modal-scrim absolute inset-0"
          onClick={dismissible ? onClose : undefined}
        />
        <div className="modal-panel relative w-[calc(90*var(--app-vw))] max-w-6xl h-[calc(85*var(--app-vh))] flex flex-col glass-modal rounded-lg overflow-hidden">
          {/* Floating close button */}
          {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="icon-btn icon-btn-lg absolute right-3 top-3 z-10 border border-border-soft bg-surface-elevated"
            aria-label={closeLabel}
          >
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
          )}
          {children}
        </div>
      </div>
    );
  }

  // Default centered dialog (desktop and mobile default)
  return (
    <div ref={surfaceRef} className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="modal-scrim absolute inset-0"
        onClick={dismissible ? onClose : undefined}
      />
      <div className={`modal-panel relative ${maxWidth} w-full mx-4 max-h-[calc(calc(100*var(--app-vh))-2rem)] flex flex-col glass-modal rounded-lg`}>
        {title && (
          <div className="flex h-12 items-center justify-between gap-3 border-b border-border-hard pl-4 pr-2 flex-shrink-0">
            <h2 className="truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">{title}</h2>
            {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="icon-btn icon-btn-lg"
              aria-label={closeLabel}
            >
              <Icon name="x" size={17} />
            </button>
            )}
          </div>
        )}
        <div className="p-4 overflow-y-auto scrollbar-thin flex-1 min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
