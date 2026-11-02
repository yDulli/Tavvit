import React from 'react';
import {
  CORNER_SCALE,
  type AvatarShape,
  type Corners,
  type Density,
  type Font,
  type MessageStyle,
} from '../../../../utils/appearanceOptions';

/**
 * The little pictures on the choices of Settings, Appearance. Each draws what
 * the choice does, in a few flat boxes, so a person can pick by looking. They
 * are decoration for the eye only (the card's text names the choice), and they
 * are made of the same tokens as the real thing, so they follow the theme.
 */

const LINE = 'bg-txt-tertiary/40';
const BOX = 'bg-surface-elevated border border-border-soft';

export function CornersPreview({ corners }: { corners: Corners }): React.JSX.Element {
  const scale = CORNER_SCALE[corners];
  return (
    <span className="flex items-center gap-1.5 desktop:gap-2">
      <span className={`h-9 w-10 desktop:w-14 ${BOX}`} style={{ borderRadius: 8 * scale }} />
      <span className="flex flex-col gap-1.5">
        <span className="h-3.5 w-7 bg-accent-primary desktop:w-9" style={{ borderRadius: 4 * scale }} />
        <span className={`h-3.5 w-7 desktop:w-9 ${BOX}`} style={{ borderRadius: 4 * scale }} />
      </span>
    </span>
  );
}

const AVATAR_COLOURS = ['bg-accent-coral', 'bg-accent-sky', 'bg-accent-mint'] as const;

export function AvatarsPreview({ shape }: { shape: AvatarShape }): React.JSX.Element {
  return (
    <span data-avatar={shape} className="flex items-center gap-1 desktop:gap-2">
      {AVATAR_COLOURS.map((colour) => (
        <span
          key={colour}
          className={`h-6 w-6 desktop:h-8 desktop:w-8 ${colour}`}
          style={{ borderRadius: 'calc(var(--avatar-roundness, 0.22) * 100%)' }}
        />
      ))}
    </span>
  );
}

/** Two message lines drawn the way the chosen style draws them. */
export function MessageStylePreview({ style }: { style: MessageStyle }): React.JSX.Element {
  const face = (colour: string) => <span className={`h-3.5 w-3.5 flex-shrink-0 rounded-[3px] ${colour}`} />;
  if (style === 'bubbles') {
    return (
      <span className="flex w-full flex-col gap-1.5 px-2 desktop:px-3">
        <span className="flex items-start gap-1.5">
          {face('bg-accent-sky')}
          <span className={`h-4 min-w-0 max-w-20 flex-1 rounded-[5px] rounded-tl-[1px] ${BOX}`} />
        </span>
        <span className="flex justify-end">
          <span className="h-4 w-3/4 max-w-16 rounded-[5px] rounded-tr-[1px] border border-accent-primary/60 bg-accent-primary/25" />
        </span>
      </span>
    );
  }
  if (style === 'rows') {
    return (
      <span className="flex w-full flex-col gap-2 px-3">
        {[22, 30].map((width) => (
          <span key={width} className="flex items-center gap-2">
            {face('bg-accent-sky')}
            <span className="flex flex-col gap-1">
              <span className="h-1.5 w-9 rounded-full bg-txt-secondary/70" />
              <span className={`h-1.5 rounded-full ${LINE}`} style={{ width: width * 2 }} />
            </span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col gap-2 px-3">
      {[26, 34, 20].map((width) => (
        <span key={width} className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-txt-tertiary/60" />
          <span className="h-1.5 w-6 rounded-full bg-txt-secondary/70" />
          <span className={`h-1.5 rounded-full ${LINE}`} style={{ width: width * 2 }} />
        </span>
      ))}
    </span>
  );
}

export function DensityPreview({ density }: { density: Density }): React.JSX.Element {
  const gap = density === 'compact' ? 'gap-[3px]' : density === 'cozy' ? 'gap-[7px]' : 'gap-[12px]';
  return (
    <span className={`flex w-full flex-col px-2 desktop:px-4 ${gap}`}>
      {[44, 30, 38, 24].slice(0, density === 'spacious' ? 3 : 4).map((width) => (
        <span key={width} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px] bg-accent-sky" />
          <span className={`h-1.5 rounded-full ${LINE}`} style={{ width: width * 2 }} />
        </span>
      ))}
    </span>
  );
}

/** The sample is the same in every language: it shows the shape of the letters, not a meaning. */
const FONT_SAMPLE = 'Ag'; // i18n-check: allow-literal (a specimen of the typeface, not text)

export function FontPreview({ font }: { font: Font }): React.JSX.Element {
  return (
    <span data-font={font} className="text-2xl font-semibold text-txt-primary" style={{ fontFamily: 'var(--font-ui)' }}>
      {FONT_SAMPLE}
    </span>
  );
}
