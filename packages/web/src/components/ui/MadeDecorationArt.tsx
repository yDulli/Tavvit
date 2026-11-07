import { useState, type CSSProperties } from 'react';
import type { CustomDecorationView } from '@backspace/shared/src/customDecorations';
import { cssUrl } from '../../utils/cssUrl';
import { madeEffectParticles, particleStyle } from '../../utils/decorations';
import type { DecorationMotion } from './Avatar';
import { useGatedPicture } from './ExternalMedia';

/**
 * Decorations people made (docs/systems/decorations.md, "Made by people"), as every surface draws
 * them: a picture its maker uploaded, through the same consent a picture from another server needs
 * (`useGatedPicture`). An animated one stands still on its first frame where the decoration may not
 * move (`data-motion` on the layer, and Reduce motion), and moves where it may. A picture that does
 * not load (its design was removed since) is drawn as nothing.
 */
export function MadePicture({ view, motion, className }: { view: CustomDecorationView; motion: DecorationMotion; className: string }) {
  const moving = useGatedPicture(view.image);
  const still = useGatedPicture(view.still);
  const [failed, setFailed] = useState(false);
  if (failed || !moving) return null;
  const fail = () => setFailed(true);
  if (!still) return <img className={className} src={moving} alt="" draggable={false} decoding="async" onError={fail} />;
  return (
    <>
      <img className={`${className} deco-made-still`} src={still} alt="" draggable={false} decoding="async" onError={fail} />
      {/* Fetched only once it is shown: a list of people who wear moving frames loads the still ones. */}
      <img className={`${className} deco-made-moving`} src={moving} alt="" draggable={false} decoding="async" loading={motion === 'on' ? 'eager' : 'lazy'} onError={fail} />
    </>
  );
}

/**
 * An effect someone made: a few of their piece, moving as one of Tavvit's effects does
 * (`data-made-motion`, with the drawn effects' keyframes in decorations.css), the moving picture
 * where it may move and its first frame under Reduce motion. Never one picture over the whole
 * profile: Tavvit decides how many pieces there are and how large (`madeEffectParticles`). A piece
 * that does not load (its design was removed since) draws nothing.
 */
export function MadeEffect({ view, className = '', motion = 'on' }: { view: CustomDecorationView; className?: string; motion?: 'on' | 'hover' }) {
  const moving = useGatedPicture(view.image);
  const still = useGatedPicture(view.still);
  if (!moving) return null;
  const moves = view.motion ?? 'fall';
  const pictures = { '--made-moving': cssUrl(moving), '--made-still': cssUrl(still ?? moving) } as CSSProperties;
  return (
    <div aria-hidden="true" className={`deco-effect ${className}`} data-effect="made" data-made-motion={moves} data-motion={motion} style={pictures}>
      {madeEffectParticles(moves).map((particle, index) => <i key={index} style={particleStyle(particle) as CSSProperties} />)}
    </div>
  );
}

/**
 * A made frame over an avatar: its picture in the same view a drawn frame takes, a fifth larger
 * than the picture on every side, with its middle kept clear (decorations.css) so that it never
 * covers the person's own picture.
 */
export function MadeFrame({ view, motion, mask }: { view: CustomDecorationView; motion: DecorationMotion; mask?: string }) {
  const style: CSSProperties | undefined = mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined;
  return (
    <span aria-hidden="true" className="deco-made-frame" data-motion={motion} style={style}>
      <MadePicture view={view} motion={motion} className="deco-made-fill" />
    </span>
  );
}
