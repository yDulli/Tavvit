import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { cropImage } from '../../utils/cropImage';
import { Icon } from './Icon';
import { RangeSlider } from './RangeSlider';

interface ImageCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  onCropComplete: (blob: Blob) => void;
  title?: string;
  aspectRatio?: number;
  cropShape?: 'round' | 'rect';
  maxOutputDimension?: number;
  outputType?: string;
  /**
   * For an animation: a canvas keeps one frame, so the chosen area is handed
   * over as it is and the caller has the server cut every frame. Whoever
   * supplies this shows its own progress and errors.
   */
  onAnimatedCrop?: (area: { x: number; y: number; width: number; height: number }) => void | Promise<void>;
}

export function ImageCropModal({
  isOpen,
  onClose,
  imageSrc,
  onCropComplete,
  title,
  aspectRatio = 1,
  cropShape = 'round',
  maxOutputDimension,
  outputType,
  onAnimatedCrop,
}: ImageCropModalProps) {
  const { t } = useTranslation(['uploads', 'common']);
  const heading = title ?? t('uploads:crop.title');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleApply = async () => {
    if (!croppedAreaPixels) return;
    if (onAnimatedCrop) {
      // Whole pixels, and at least one: the server takes nothing else.
      void onAnimatedCrop({
        x: Math.max(0, Math.round(croppedAreaPixels.x)),
        y: Math.max(0, Math.round(croppedAreaPixels.y)),
        width: Math.max(1, Math.round(croppedAreaPixels.width)),
        height: Math.max(1, Math.round(croppedAreaPixels.height)),
      });
      onClose();
      return;
    }
    setIsProcessing(true);
    try {
      const blob = await cropImage(imageSrc, croppedAreaPixels, outputType ?? 'image/webp', {
        maxDimension: maxOutputDimension,
        outputType,
      });
      onCropComplete(blob);
      onClose();
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset state when opened with a new image
  useEffect(() => {
    if (isOpen) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setIsProcessing(false);
    }
  }, [isOpen, imageSrc]);

  useEffect(() => {
    if (!isOpen) return;
    // The crop opens over another dialog (the account panel, a space
    // profile). Escape closes the crop alone: caught on the way down and
    // stopped there, it never reaches the dialog underneath.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-surface-overlay" onClick={onClose} />
      <div className="relative max-w-md w-full mx-4 glass-modal rounded-lg animate-slide-up">
        {/* Title bar: the same 48px row with a hairline as every dialog (Modal.tsx). */}
        <div className="flex h-12 items-center justify-between gap-3 border-b border-border-hard pl-4 pr-2">
          <h2 className="truncate text-lead font-semibold text-txt-primary">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn icon-btn-lg"
            aria-label={t('common:actions.close')}
            title={t('common:actions.close')}
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        {/* Crop area */}
        {/* react-easy-crop mixes DOM rect/client coordinates with CSS pixels.
            Keep only its interactive canvas at effective 100%; dialog controls
            still use the selected interface scale. */}
        <div className="relative h-[350px] mx-4 mt-4 rounded-md overflow-hidden bg-surface-base"
          style={{ zoom: 'calc(1 / var(--interface-scale, 1))' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspectRatio}
            cropShape={cropShape}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-4 pt-3 flex items-center gap-3">
          <svg className="w-4 h-4 text-txt-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
          </svg>
          <RangeSlider value={zoom} min={1} max={3} step={0.05} onChange={setZoom} className="min-w-0 flex-1" />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-quiet"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isProcessing || !croppedAreaPixels}
            aria-busy={isProcessing}
            className="btn-primary"
          >
            {isProcessing ? t('uploads:crop.applying') : t('common:actions.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
