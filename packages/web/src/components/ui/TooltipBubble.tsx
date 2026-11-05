import React, { forwardRef } from 'react';

/**
 * The look of every tooltip in the app: 12px on the `.glass` popover tier, a 5px corner, no pointer
 * events. `TooltipLayer` (the name of an icon-only control) and `Tooltip` (a mark that is not a
 * control: a federation globe, a status, a badge) both draw it, so the two can never look different.
 */
export const TooltipBubble = forwardRef<HTMLDivElement, {
  style: React.CSSProperties;
  /** Long names (a German or Russian label) may wrap at 280px; a mark's short word stays on one line. */
  wrap?: boolean;
  children: React.ReactNode;
}>(function TooltipBubble({ style, wrap = false, children }, ref) {
  return (
    <div
      ref={ref}
      role="tooltip"
      style={style}
      className={`glass pointer-events-none rounded-md px-2 py-1 text-meta font-medium leading-snug text-txt-primary animate-fade-in ${
        wrap ? 'max-w-[280px] [overflow-wrap:anywhere]' : 'whitespace-nowrap'
      }`}
    >
      {children}
    </div>
  );
});
