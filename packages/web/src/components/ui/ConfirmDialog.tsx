import React, { useEffect, useCallback, useId, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useExitGhost } from '../../hooks/useExitGhost';
import { usePortalContainer } from '../../hooks/usePortalContainer';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  /** The dialog asks for something first (a password, a reason) that is not there yet. */
  confirmDisabled?: boolean;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const portalContainer = usePortalContainer();
  if (!props.isOpen) return null;
  return ReactDOM.createPortal(<ConfirmSurface {...props} />, portalContainer);
}

function ConfirmSurface({
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  loading = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common']);
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Always kept from the dialog behind this one, also while the action runs: closing that
    // would hide how it turned out.
    e.stopPropagation();
    if (!loading) onClose();
  }, [onClose, loading]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  const titleId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  useExitGhost(surfaceRef);

  // Danger destroys something (the rose fill, white text); a warning asks for
  // care (amber, with dark text, since white on amber does not read).
  const confirmClass = variant === 'danger'
    ? 'btn-danger'
    : 'btn-primary bg-accent-amber text-surface-base [--btn-glow:var(--accent-amber)] hover:bg-accent-amber/90 active:bg-accent-amber/80';

  return (
    <div ref={surfaceRef} className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div
        className="modal-scrim absolute inset-0"
        onClick={() => { if (!loading) onClose(); }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-panel relative max-w-[440px] w-full mx-4 glass-modal rounded-lg"
      >
        <div className="p-5">
          <h3 id={titleId} className="mb-1.5 text-title font-[450] tracking-[-0.016em] text-txt-primary">{title}</h3>
          <div className="text-ui leading-relaxed text-txt-secondary">{description}</div>
        </div>
        <div className="flex justify-end gap-2 rounded-b-lg border-t border-border-hard bg-surface-channel/40 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn-quiet"
          >
            {cancelLabel ?? t('common:actions.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            aria-busy={loading}
            className={confirmClass}
          >
            {confirmLabel ?? t('common:actions.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
