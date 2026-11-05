import { useSpaceBanner } from '../../hooks/useSpaceBanner';

/**
 * The band across the top of a space's card: its banner when it has one the page may show, and
 * otherwise the space's own colour painted with depth (`.banner-depth`), as Explore's cards do. It is
 * decoration (the card names the space in words), so a screen reader skips it. A space whose instance
 * cannot be reached right now is shown faded, never its words.
 */
export function SpaceBand({ banner, fill, faded = false, className = '' }: {
  banner: string | null | undefined;
  /** The paint without a picture: `bannerFill` of the space's colour. */
  fill: string;
  faded?: boolean;
  className?: string;
}) {
  const picture = useSpaceBanner(banner);
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden ${picture.src ? '' : 'banner-depth'} ${faded ? 'opacity-50 saturate-50' : ''} ${className}`}
    >
      {picture.src ? (
        <img
          src={picture.src}
          alt=""
          decoding="async"
          loading="lazy"
          draggable={false}
          onError={picture.onError}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0" style={{ background: fill }} />
      )}
    </span>
  );
}
