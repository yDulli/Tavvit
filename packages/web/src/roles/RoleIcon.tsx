import { useId, useSyncExternalStore } from 'react';
import { roleIconGlyph, type RoleGlyphId } from '@backspace/shared/src/roleGlyphs';

type Paths = Record<RoleGlyphId, string>;

let paths: Paths | null = null;
let loading = false;
const listeners = new Set<() => void>();

/** The drawings come in their own file, once, the first time anything wants one. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!paths && !loading) {
    loading = true;
    import('./roleGlyphPaths')
      .then((module) => {
        paths = module.ROLE_GLYPH_PATHS;
        for (const notify of listeners) notify();
      })
      // The next one to ask tries again; until then a name simply goes without its icon.
      .catch(() => { loading = false; });
  }
  return () => { listeners.delete(listener); };
}

function useGlyphPaths(): Paths | null {
  return useSyncExternalStore(subscribe, () => paths);
}

interface GlyphProps {
  id: RoleGlyphId;
  size?: number;
  /** The role's colour; without one the drawing takes the text colour around it. */
  color?: string | null;
  /** With a colour, draws the role's gradient across the icon. */
  colorSecondary?: string | null;
  /** A soft light in the role's colour, for where the icon stands alone. */
  glow?: boolean;
  className?: string;
}

/** One icon of the set, in a role's colour or across its gradient. Holds its size while its drawing loads. */
export function RoleGlyph({ id, size = 14, color, colorSecondary, glow = false, className = '' }: GlyphProps) {
  const drawings = useGlyphPaths();
  const gradientId = `role-glyph-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const gradient = Boolean(color && colorSecondary);
  const fill = gradient ? `url(#${gradientId})` : color ?? 'currentColor';
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      style={glow && color ? { filter: `drop-shadow(0 0 ${Math.round(size / 3)}px ${color}73)` } : undefined}
    >
      {gradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color ?? undefined} />
            <stop offset="1" stopColor={colorSecondary ?? undefined} />
          </linearGradient>
        </defs>
      )}
      {drawings && <path d={drawings[id]} fill={fill} />}
    </svg>
  );
}

/**
 * What `roles.icon` holds, drawn: an icon of the set, or the one meaning the same as an emoji
 * from before the set existed. An emoji with no such icon is shown as it is, so nothing that
 * was there disappears.
 */
export function RoleIcon({ icon, color, colorSecondary, size = 14, glow, className = '' }: Omit<GlyphProps, 'id'> & { icon: string }) {
  const glyph = roleIconGlyph(icon);
  if (glyph) return <RoleGlyph id={glyph} size={size} color={color} colorSecondary={colorSecondary} glow={glow} className={className} />;
  return <span aria-hidden="true" className={`flex-shrink-0 leading-none ${className}`} style={{ fontSize: size }}>{icon}</span>;
}
