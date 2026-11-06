import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../../stores/voiceStore';
import {
  BACKGROUND_CHOICES,
  NO_BACKGROUND,
  backgroundKey,
  isActiveBackground,
  sameBackground,
  type CameraBackground,
} from '../../../camera/backgrounds';
import { loadBackgroundProcessor } from '../../../camera';
import { forgetOwnImage, loadOwnImage, OwnImageRejected, saveOwnImage, useOwnImage, type OwnImageProblem } from '../../../camera/ownImage';
import { SCENE_PICTURES } from '../../../camera/scenes';
import { useCameraStrain } from '../../../camera/strain';
import type { BackgroundPreviewStatus } from '../../../camera/useBackgroundPreview';
import { Icon } from '../../ui/Icon';
import { FormError, useRadioArrows } from './_shared/SettingsControls';

/** The picture types the picker offers; anything the browser cannot open is refused when it is read. */
const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/**
 * A small room for the tiles that keep the person's own room: a window, a
 * shelf of books, a lamp, a plant. The blur tiles soften it; the figure in
 * front stays sharp.
 */
function MiniRoom({ blur }: { blur: number }) {
  return (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      // Scaled up a little when blurred, so its soft edge stays outside the tile.
      style={blur > 0 ? { filter: `blur(${blur}px)`, transform: 'scale(1.12)' } : undefined}
      aria-hidden="true"
    >
      <rect width="160" height="90" fill="#262830" />
      <rect x="14" y="12" width="46" height="36" rx="1.5" fill="#3d5679" />
      <rect x="36" y="12" width="2" height="36" fill="#262830" />
      <rect x="14" y="29" width="46" height="2" fill="#262830" />
      <rect x="96" y="30" width="7" height="14" fill="#9a4d63" />
      <rect x="104" y="27" width="6" height="17" fill="#3f8a6a" />
      <rect x="111" y="32" width="8" height="12" fill="#a8802e" />
      <rect x="121" y="29" width="6" height="15" fill="#6e66a8" />
      <rect x="128" y="33" width="7" height="11" fill="#3f6f99" />
      <rect x="92" y="44" width="56" height="3" fill="#6b5340" />
      <circle cx="140" cy="16" r="6" fill="#f2b46a" />
      <rect x="0" y="66" width="160" height="24" fill="#1c1d23" />
      <ellipse cx="22" cy="70" rx="15" ry="13" fill="#2f6b4a" />
    </svg>
  );
}

/** The person in front of the background. */
function Figure() {
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMax meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <circle cx="80" cy="45" r="13" fill="#3b3d47" stroke="#ffffff" strokeOpacity="0.16" />
      <path d="M53 91 C55 71 67 63 80 63 C93 63 105 71 107 91 Z" fill="#3b3d47" stroke="#ffffff" strokeOpacity="0.16" />
    </svg>
  );
}

function Swatch({ choice, own, saving }: { choice: CameraBackground; own: string | null; saving: boolean }) {
  switch (choice.kind) {
    case 'none':
      return <><MiniRoom blur={0} /><Figure /></>;
    case 'blur':
      return <><MiniRoom blur={choice.strength === 'light' ? 1.6 : 4.5} /><Figure /></>;
    case 'scene':
      return (
        <>
          <img src={SCENE_PICTURES[choice.scene].thumb} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <Figure />
        </>
      );
    case 'own':
      if (own) {
        return (
          <>
            <img src={own} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            <Figure />
          </>
        );
      }
      return (
        <span className="absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-border-soft text-txt-tertiary">
          <Icon name={saving ? 'hourglass' : 'upload'} size={18} />
        </span>
      );
  }
}

/** A short line under the tiles; `warning` for what the person should act on. */
function Note({ tone = 'neutral', children }: { tone?: 'neutral' | 'warning'; children: ReactNode }) {
  return (
    <p className={`flex items-start gap-1.5 text-meta leading-snug ${tone === 'warning' ? 'text-txt-warning' : 'text-txt-tertiary'}`}>
      {tone === 'warning' && <Icon name="alert" size={14} className="mt-px flex-shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/**
 * What the camera shows behind the person (camera/backgrounds.ts): the room
 * as it is, softly or strongly blurred, one of the scenes, or a picture of
 * the person's own that stays on this device. A choice applies at once, to
 * the preview and to a camera that is on in a call. Shown only where the
 * browser can do it (`cameraBackgroundsSupported`).
 */
export function CameraBackgroundPicker({ labelledBy, preview }: { labelledBy: string; preview: BackgroundPreviewStatus }) {
  const { t } = useTranslation('settings');
  const background = useVoiceStore((s) => s.cameraBackground);
  const setBackground = useVoiceStore((s) => s.setCameraBackground);
  const own = useOwnImage();
  const strained = useCameraStrain((s) => s.strained);
  const fileRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<OwnImageProblem | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadOwnImage();
  }, []);

  const ownReady = own.status === 'ready';
  const pickPicture = () => fileRef.current?.click();

  const choose = (key: string) => {
    const choice = BACKGROUND_CHOICES.find((candidate) => backgroundKey(candidate) === key);
    if (!choice) return;
    if (choice.kind === 'own' && !ownReady) {
      pickPicture();
      return;
    }
    setProblem(null);
    setBackground(choice);
    // Fetch the processor's files now, so the camera does not wait for them
    // the first time it goes on with a background.
    if (isActiveBackground(choice)) {
      void loadBackgroundProcessor()
        .then((processors) => processors.prefetchBackgroundAssets())
        .catch(() => {});
    }
  };

  // The arrow keys move between the backgrounds there are; "Your picture"
  // before it has one is reached by click or Tab, since it opens a file dialog.
  const arrowKeys = BACKGROUND_CHOICES.map(backgroundKey).filter((key) => key !== 'own' || ownReady);
  const arrows = useRadioArrows(arrowKeys, backgroundKey(background), choose);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSaving(true);
    setProblem(null);
    try {
      await saveOwnImage(file);
      setBackground({ kind: 'own' });
    } catch (error) {
      setProblem(error instanceof OwnImageRejected ? error.problem : 'notKept');
    } finally {
      setSaving(false);
    }
  };

  const removePicture = async () => {
    setProblem(null);
    await forgetOwnImage();
    if (useVoiceStore.getState().cameraBackground.kind === 'own') setBackground(NO_BACKGROUND);
  };

  const label = (choice: CameraBackground): string => {
    switch (choice.kind) {
      case 'none':
        return t('voice.video.background.choice.none');
      case 'blur':
        return t(`voice.video.background.choice.blur.${choice.strength}`);
      case 'scene':
        return t(`voice.video.background.choice.scene.${choice.scene}`);
      case 'own':
        return t('voice.video.background.choice.own');
    }
  };

  return (
    <div className="space-y-3">
      <div
        ref={arrows.ref}
        role="radiogroup"
        aria-labelledby={labelledBy}
        onKeyDown={arrows.onKeyDown}
        className="grid grid-cols-3 gap-2"
      >
        {BACKGROUND_CHOICES.map((choice) => {
          const key = backgroundKey(choice);
          const selected = sameBackground(choice, background);
          const opensDialog = choice.kind === 'own' && !ownReady;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-haspopup={opensDialog ? 'dialog' : undefined}
              aria-busy={choice.kind === 'own' && saving ? true : undefined}
              tabIndex={selected || opensDialog ? 0 : -1}
              onClick={() => choose(key)}
              className={`min-w-0 rounded-lg border p-1.5 text-left transition-colors duration-100 ${
                selected
                  ? 'border-accent-primary bg-accent-primary/[0.06]'
                  : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover active:bg-interactive-active'
              }`}
            >
              <span className="relative block aspect-video overflow-hidden rounded-md bg-surface-input" aria-hidden="true">
                <Swatch choice={choice} own={own.url} saving={saving} />
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 px-0.5">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 flex-shrink-0 rounded-full border ${selected ? 'border-accent-primary bg-accent-primary' : 'border-interactive-muted'}`}
                />
                <span className="min-w-0 truncate text-meta font-medium text-txt-primary">
                  {opensDialog ? t('voice.video.background.own.add') : label(choice)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <input ref={fileRef} type="file" accept={ACCEPTED} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void onFile(event)} />

      {ownReady && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-quiet btn-sm" onClick={pickPicture} aria-busy={saving}>
            <Icon name="image" size={14} />
            {t('voice.video.background.own.replace')}
          </button>
          <button type="button" className="btn-quiet btn-sm" onClick={() => void removePicture()}>
            <Icon name="trash" size={14} />
            {t('voice.video.background.own.remove')}
          </button>
        </div>
      )}

      {problem && <FormError>{t(`voice.video.background.own.problem.${problem}`)}</FormError>}
      {background.kind === 'own' && own.status === 'none' && <Note tone="warning">{t('voice.video.background.own.missing')}</Note>}
      {preview === 'failed' && <Note tone="warning">{t('voice.video.background.failed')}</Note>}
      {strained && isActiveBackground(background) && <Note tone="warning">{t('voice.video.background.strained')}</Note>}
      <Note>{t('voice.video.background.private')}</Note>
    </div>
  );
}
