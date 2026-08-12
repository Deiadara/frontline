import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header label rendered in the display font. */
  title?: ReactNode;
  /** Optional element pinned to the right of the header. */
  action?: ReactNode;
}

/**
 * Bordered surface primitive: 1px neon-cyan border on a raised night surface.
 * Square corners, HUD-style header.
 */
export function Panel({ title, action, className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn('flex flex-col border border-neon-cyan/20 bg-night-raised', className)}
      {...rest}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="flex items-center justify-between gap-2 border-b border-neon-cyan/15 px-4 py-2.5">
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-steel-300">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
