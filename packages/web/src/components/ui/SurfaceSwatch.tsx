import { surfaceChannels, type SurfaceSettings } from '../../utils/appTheme';

/**
 * A theme as a little screen: the bar along the top, the sidebar with the row you are on (its
 * accent edge), the conversation and a floating card, each in the theme's own surface colours,
 * parted by the theme's own hairline. `accent` paints the edge in a look's own accent; without it
 * the edge takes the app's.
 */
export function SurfaceSwatch({ settings, accent = null, className = 'h-14' }: {
  settings: SurfaceSettings;
  accent?: string | null;
  className?: string;
}) {
  const rgb = (token: Parameters<typeof surfaceChannels>[1]) => `rgb(${surfaceChannels(settings, token).join(' ')})`;
  const hairline = rgb('--border-hard');
  return (
    <span className={`flex flex-col overflow-hidden rounded-md border border-border-soft ${className}`} aria-hidden="true">
      <span className="h-2.5 flex-shrink-0" style={{ backgroundColor: rgb('--bg-base'), borderBottom: `1px solid ${hairline}` }} />
      <span className="flex flex-1">
        <span className="relative w-1/4" style={{ backgroundColor: rgb('--bg-channel'), borderRight: `1px solid ${hairline}` }}>
          <span className="absolute inset-x-1 top-1.5 h-1.5 rounded-[1px] bg-white/[0.08]" />
          <span className={`absolute left-1 top-1.5 h-1.5 w-[2px] ${accent ? '' : 'bg-accent-primary'}`} style={accent ? { backgroundColor: accent } : undefined} />
        </span>
        <span className="relative flex-1" style={{ backgroundColor: rgb('--bg-chat') }}>
          <span className="absolute left-1.5 top-1.5 h-1 w-8 rounded-[1px] bg-white/[0.14]" />
          <span className="absolute left-1.5 top-3.5 h-1 w-5 rounded-[1px] bg-white/[0.08]" />
          <span className="absolute bottom-1.5 right-1.5 h-3 w-8 rounded-[2px]" style={{ backgroundColor: rgb('--bg-elevated'), border: `1px solid ${rgb('--border-soft')}` }} />
        </span>
      </span>
    </span>
  );
}
